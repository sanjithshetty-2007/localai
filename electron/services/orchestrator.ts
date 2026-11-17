import fs from 'node:fs'
import path from 'node:path'
import type { Attachment, ChangeSet, ChatEvent, ChatMessage, ChatRequest, FileNode, MessageMeta, OllamaModel, Settings } from '../../shared/types'
import { getSettings, newId } from './db'
import { OllamaClient, type OllamaChatMessage } from './ollama'
import { buildContext, classify, type Route } from './context'
import { getAttachments, getImageBase64 } from './documents'
import type { ProjectIndexer } from './indexer'
import { EXPLICIT_REF, type KnowledgeLibrary } from './knowledge'
import { appendProjectNote } from './indexer'
import { applyChangeSet, buildChangeSet, parseActions } from './file-actions'
import type { CodeRunner } from '../terminal/runner'
import { getWorkspaceRoot, resolveInWorkspace, toRelative } from '../security/paths'
import { searchWorkspace } from '../filesystem/fs-service'
import { collectCodeFiles, compileCheck, hasMain, removeMain, runCppTest } from './compile-check'
import { RepetitionMonitor } from './text-utils'
import * as memory from './memory'

type Role = 'general' | 'coder' | 'reasoning' | 'vision'

/** Rough token count for sizing the context window (≈3.2 characters per token). */
function estimateTokens(messages: OllamaChatMessage[]): number {
  return Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3.2) + messages.length * 8
}

const REASONING_GUIDE =
  '\n\nThink it through carefully. Once you have an approach and have checked it (including edge cases), stop deliberating and give the final answer: the approach in clear steps, time and space complexity, and complete, working code when code is requested. End with one line in the form `FINAL ANSWER: <the result>`.'

/** The text after the last "FINAL ANSWER:" line, if any. */
function finalAnswerOf(text: string): string | null {
  const m = [...text.matchAll(/FINAL ANSWER\s*[:：]\s*([^\n]+)/gi)].at(-1)
  return m ? m[1].trim() : null
}

/** Compare final answers ignoring formatting: case, spaces, markdown, punctuation between items. */
export function normalizeFinal(s: string): string {
  return s
    .toLowerCase()
    .replace(/\\boxed\{([^}]*)\}/g, '$1')
    .replace(/[\s,*_`$\\→]+/g, '')
    .replace(/\.$/, '')
}

/**
 * DeepSeek recommends no system prompt for R1 models: fold system instructions into the
 * current user message (history stays as it is) and add a short answer-format guide.
 */
function toReasoningMessages(messages: OllamaChatMessage[]): OllamaChatMessage[] {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content)
  const rest = messages.filter((m) => m.role !== 'system')
  const last = rest[rest.length - 1]
  if (!last || last.role !== 'user') return messages
  const merged: OllamaChatMessage = { ...last, content: `${system.join('\n\n')}\n\n${last.content}${REASONING_GUIDE}` }
  return [...rest.slice(0, -1), merged]
}

const FILLER = new Set('a an the and or but so to of in on for with is are was be it its that this those these them they he she do does did can could would should will please me my i you your we our what why how which who when where about more elaborate explain example examples again also same above previous continue tell show give detail details further elaborate one some any just like there here then than'.split(' '))

/** A follow-up has almost no new content words ("explain that more", "why?", "give an example"). */
export function isFollowUp(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return words.length > 0 && words.length <= 12 && words.filter((w) => !FILLER.has(w)).length <= 1
}

const EMBED_RE = /embed|bge|nomic|minilm|e5-/i
// Thinking models (deepseek-r1, qwen3) get a bounded reasoning budget (~1.5 min on an 8 GB GPU).
const ANSWER_TOKENS = 2560 // room for the final answer after thinking
const FINISH_THINK_TOKENS = 3072 // extra thinking allowed when finishing from the model's own notes
const MAX_REASONING_CTX = 32768
// Questions whose answer should include code (finished by the coding model if reasoning runs out).
const CODE_ANSWER_RE = /\b(code|program|implement|function|solution|leetcode|c\+\+|cpp|java|python|javascript|write)\b/i

/**
 * The single orchestration layer. Every AI interaction — chat, coding, debugging,
 * screenshots, PDFs, repositories — flows through send(). Internally it may use
 * several Ollama models, but the user sees one assistant and one conversation.
 */
export class Orchestrator {
  private active = new Map<string, AbortController>()

  constructor(
    private ollama: OllamaClient,
    private indexer: ProjectIndexer,
    private runner: CodeRunner,
    private emit: (e: ChatEvent) => void,
    private getTree: () => FileNode | null,
    private onFilesTouched: (paths: string[]) => void,
    private knowledge: KnowledgeLibrary
  ) {}

  stop(conversationId: string): void {
    this.active.get(conversationId)?.abort()
  }

  isBusy(conversationId: string): boolean {
    return this.active.has(conversationId)
  }

  private async installedModels(): Promise<OllamaModel[]> {
    const models = await this.ollama.tags()
    return models.filter((m) => !EMBED_RE.test(m.name))
  }

  private pick(role: Role, settings: Settings, installed: OllamaModel[]): string | null {
    const names = installed.map((m) => m.name)
    const has = (n: string) => !!n && (names.includes(n) || names.includes(n + ':latest'))
    const norm = (n: string) => (names.includes(n) ? n : n + ':latest')
    const order: string[] =
      role === 'reasoning'
        ? [settings.roles.reasoning, settings.roles.coder, settings.roles.general]
        : role === 'coder'
          ? [settings.roles.coder, settings.roles.general]
          : role === 'vision'
            ? [settings.roles.vision]
            : [settings.roles.general, settings.roles.coder]
    for (const n of order) if (has(n)) return norm(n)
    if (role === 'vision') return null
    // Fall back to any installed chat model that is not vision-only.
    const fallback = installed.find((m) => !(m.capabilities ?? []).includes('vision')) ?? installed[0]
    return fallback?.name ?? null
  }

  private async ensureResident(model: string, settings: Settings, status: (t: string) => void): Promise<void> {
    if (!settings.singleModelResidency) return
    let unloaded = false
    try {
      const running = await this.ollama.ps()
      for (const r of running) {
        // Embedding models are tiny and shared with the library; never evict them.
        if (r.name !== model && !EMBED_RE.test(r.name) && r.name.split(':')[0] !== settings.roles.embedding.split(':')[0]) {
          status(`Unloading ${r.name} to free memory…`)
          await this.ollama.unload(r.name).catch(() => undefined)
          unloaded = true
        }
      }
      // Wait until Ollama has really released the GPU memory before the next model loads;
      // loading into still-occupied VRAM can crash the CUDA runner (seen on RTX 50-series).
      if (unloaded) {
        for (let i = 0; i < 20; i++) {
          const now = await this.ollama.ps().catch(() => [])
          if (!now.some((r) => r.name !== model && !EMBED_RE.test(r.name) && r.name.split(':')[0] !== settings.roles.embedding.split(':')[0])) break
          await new Promise((res) => setTimeout(res, 500))
        }
        await new Promise((res) => setTimeout(res, 1500))
      }
      if (!running.some((r) => r.name === model)) status(`Loading ${model}…`)
    } catch {
      /* ps unsupported: continue */
    }
  }

  /**
   * Opt-in "Test code by running it": the coding model writes a test main() (examples from the
   * problem plus edge cases, asserts only for certain results), the solution is compiled and run
   * in a temp folder with a 10 s limit, and a crash, hang or failed assert goes back to the coding
   * model for one repair, which is tested again.
   */
  private async testAndRepairCode(
    req: ChatRequest,
    content: string,
    settings: Settings,
    installed: OllamaModel[],
    status: (t: string) => void,
    onRetry: (t: string) => void,
    meta: MessageMeta,
    ev: { conversationId: string; messageId: string },
    append: (text: string) => void
  ): Promise<void> {
    void ev
    const coder = this.pick('coder', settings, installed)
    const cpp = collectCodeFiles(content).filter((f) => f.lang === 'cpp' && !/\.(h|hpp)$/.test(f.name))
    if (!coder || cpp.length !== 1) {
      if (cpp.length > 1) meta.steps!.push('Code test skipped (program has several files)')
      return
    }
    await this.ensureResident(coder, settings, status)
    let solution = cpp[0].content
    const isLeetCode = /\bclass\s+Solution\b/.test(solution)
    let testMain: string | null = null
    if (isLeetCode || !hasMain(solution)) {
      status('Writing tests for the solution…')
      const res = await this.ollama.chat({
        model: coder,
        messages: [
          {
            role: 'user',
            content: `Problem:\n${req.text}\n\nSolution:\n\`\`\`cpp\n${removeMain(solution)}\n\`\`\`\n\nWrite ONLY a C++ int main() that tests this solution: call it on the examples from the problem and on edge cases (empty input, single element, boundary values). Use assert() only for expected results you are completely sure of. The solution and any TreeNode/ListNode structs are already defined above your code, so do not redefine them; build trees/lists yourself. Print ALL TESTS PASSED at the end. Reply with one \`\`\`cpp block.`
          }
        ],
        options: { num_ctx: settings.numCtx, temperature: 0.2, top_p: settings.topP, num_predict: 2048 },
        keepAlive: settings.keepAlive,
        onRetry
      }).catch(() => null)
      const block = res ? [...res.content.matchAll(/```(?:cpp|c\+\+)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => /\bint\s+main\s*\(/.test(b)) : undefined
      const m = block ? /\bint\s+main\s*\([^)]*\)\s*\{[\s\S]*$/.exec(block) : null
      if (!m) {
        meta.steps!.push('Code test skipped (could not write a test)')
        return
      }
      testMain = m[0]
    }
    const codeBlock = (text: string | undefined, want: (b: string) => boolean) =>
      text ? [...text.matchAll(/```(?:cpp|c\+\+)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).filter(want).at(-1) : undefined
    const mainOf = (b: string | undefined) => (b ? /\bint\s+main\s*\([^)]*\)\s*\{[\s\S]*$/.exec(b)?.[0] ?? null : null)
    const ask = (content: string, num_predict = 3072) =>
      this.ollama
        .chat({ model: coder, messages: [{ role: 'user', content }], options: { num_ctx: settings.numCtx, temperature: 0.2, top_p: settings.topP, num_predict }, keepAlive: settings.keepAlive, onRetry })
        .then((r) => r.content)
        .catch(() => undefined)

    status('Running the solution on test cases…')
    let rep = await runCppTest(solution, testMain)
    if (!rep.ran) {
      meta.steps!.push(`Code test skipped (${rep.reason})`)
      return
    }
    // A test that does not compile is the test's fault: let the coding model fix the test once.
    if (rep.reason === 'test program did not compile' && testMain) {
      const fixedTest = mainOf(codeBlock(await ask(`This C++ test main() does not compile against the solution below.\n\nSolution:\n\`\`\`cpp\n${removeMain(solution)}\n\`\`\`\n\nTest:\n\`\`\`cpp\n${testMain}\n\`\`\`\n\nCompiler errors:\n${rep.output.slice(0, 2000)}\n\nReturn ONLY the corrected int main() in one \`\`\`cpp block. Do not change or redefine the solution.`, 2048), (b) => /\bint\s+main\s*\(/.test(b)))
      if (fixedTest) {
        testMain = fixedTest
        rep = await runCppTest(solution, testMain)
      }
      if (rep.reason === 'test program did not compile') {
        meta.steps!.push('Code test skipped (could not build a compiling test)')
        return
      }
    }
    if (rep.ok) {
      meta.steps!.push('Code tested: examples and edge cases passed')
      return
    }
    // A failure may be the test's fault or the solution's. Only a corrected solution that passes
    // the same tests the original failed is ever shown to the user.
    status('A test failed — finding out whether the test or the solution is wrong…')
    const verdict = await ask(
      `Problem:\n${req.text}\n\nSolution:\n\`\`\`cpp\n${solution}\n\`\`\`\n\nTest:\n\`\`\`cpp\n${testMain ?? "(the solution's own main)"}\n\`\`\`\n\nRunning it ${rep.reason}. Output:\n${rep.output.slice(-1500)}\n\nDecide carefully whether the TEST is wrong (bad tree/list construction, wrong expected value, out-of-range access in the test) or the SOLUTION is wrong.\nIf the test is wrong reply: CULPRIT: TEST, then the corrected int main() in one \`\`\`cpp block.\nIf the solution is wrong reply: CULPRIT: SOLUTION, one sentence naming the bug, then the complete corrected solution in one \`\`\`cpp block with the same signature.`
    )
    const culprit = /CULPRIT:\s*(TEST|SOLUTION)/i.exec(verdict ?? '')?.[1]?.toUpperCase()
    if (culprit === 'TEST' && testMain) {
      const newTest = mainOf(codeBlock(verdict, (b) => /\bint\s+main\s*\(/.test(b)))
      const again = newTest ? await runCppTest(solution, newTest) : null
      meta.steps!.push(again?.ok ? 'Code tested: examples and edge cases passed (after correcting the test)' : `Code test inconclusive (${rep.reason}; the test itself looked wrong)`)
      return
    }
    if (culprit === 'SOLUTION') {
      const fixed = codeBlock(verdict, (b) => b.includes('Solution') || hasMain(b))
      if (fixed) {
        const check = await runCppTest(fixed, testMain)
        if (check.ok) {
          const why = (verdict ?? '').slice((verdict ?? '').search(/CULPRIT:/i)).split('\n').slice(1).find((l) => l.trim() && !l.startsWith('```'))?.trim()
          append(`\n\n---\n**Testing found a bug${why ? ` (${why.replace(/\*/g, '').slice(0, 200)})` : ''} — corrected solution (passes the tests the original failed):**\n\n\`\`\`cpp\n${fixed.trim()}\n\`\`\``)
          meta.steps!.push(`Code test failed (${rep.reason}); corrected solution passes the tests`)
          return
        }
      }
    }
    meta.steps!.push(`Code test inconclusive (${rep.reason}); answer left unchanged`)
  }
  async send(req: ChatRequest): Promise<void> {    if (this.active.has(req.conversationId)) throw new Error('The assistant is already answering in this conversation.')
    const settings = getSettings()
    this.ollama.setBaseUrl(settings.ollamaUrl)
    const conv = memory.getConversation(req.conversationId)
    if (!conv) throw new Error('Conversation not found')

    // Regenerate: drop the last assistant reply and reuse the last user message.
    let userMessage: ChatMessage
    let attachmentIds = req.attachmentIds
    const all = memory.getMessages(req.conversationId, false)
    if (req.regenerate) {
      const lastUserIdx = all.map((m) => m.role).lastIndexOf('user')
      if (lastUserIdx < 0) throw new Error('Nothing to regenerate')
      for (const m of all.slice(lastUserIdx + 1)) memory.deleteMessage(m.id)
      const u = all[lastUserIdx]
      attachmentIds = memory.messageAttachmentIds(u.id)
      userMessage = { ...u, attachments: getAttachments(attachmentIds) }
      req = { ...req, text: u.content, kind: u.meta?.kind ?? req.kind }
    } else {
      userMessage = {
        id: newId('msg_'),
        conversationId: req.conversationId,
        role: 'user',
        content: req.text,
        createdAt: Date.now(),
        meta: { kind: req.kind ?? 'chat', fixFile: req.kind === 'fix-request' ? req.context.lastRun?.file : undefined }
      }
      memory.insertMessage({ ...userMessage, attachmentIds })
      userMessage.attachments = getAttachments(attachmentIds)
      if (conv.title === 'New chat') {
        const t = req.text.replace(/\s+/g, ' ').trim()
        memory.renameConversation(conv.id, t.length > 60 ? t.slice(0, 57) + '…' : t || 'New chat')
      }
    }
    memory.touchConversation(conv.id, req.context.workspace)
    const history = memory.getMessages(req.conversationId).filter((m) => m.id !== userMessage.id && m.createdAt <= userMessage.createdAt)

    const messageId = newId('msg_')
    const ctrl = new AbortController()
    this.active.set(req.conversationId, ctrl)
    const started = Date.now()
    const ev = { conversationId: req.conversationId, messageId }
    this.emit({ type: 'start', ...ev, userMessage: req.regenerate ? undefined : userMessage })
    const status = (text: string) => this.emit({ type: 'status', ...ev, text })
    const onRetry = (text: string) => {
      status(text)
      meta.steps?.push(text)
    }

    let content = ''
    let thinking = ''
    const meta: MessageMeta = { steps: [], models: [] }
    let changeSet: ChangeSet | undefined
    let usedModel = ''

    try {
      const attachments = userMessage.attachments ?? []
      const { route, role } = settings.autoRouting ? classify(req, attachments) : { route: classify(req, attachments).route, role: 'general' as const }
      meta.route = route

      status('Checking local models…')
      let installed: OllamaModel[]
      try {
        installed = await this.installedModels()
      } catch {
        throw new Error(`Cannot reach Ollama at ${settings.ollamaUrl}. Start Ollama, then try again (Settings → Models shows setup help).`)
      }
      if (!installed.length) throw new Error('No models are installed in Ollama yet. Open Settings → Models and download one (for example qwen2.5-coder:7b).')
      for (const m of installed) m.capabilities = await this.ollama.capabilities(m.name)

      const mainModel = this.pick(role, settings, installed)
      if (!mainModel) throw new Error('No suitable chat model is installed.')
      usedModel = mainModel
      const mainCaps = installed.find((m) => m.name === mainModel)?.capabilities ?? []

      // ---- Images: direct (vision-capable main model) or a vision pre-pass ----
      const images = attachments.filter((a) => a.kind === 'image')
      const directImages: string[] = []
      const visionNotes: string[] = []
      if (images.length) {
        if (mainCaps.includes('vision')) {
          for (const a of images) {
            const b64 = getImageBase64(a.id)
            if (b64) directImages.push(b64)
          }
        } else {
          let visionModel = this.pick('vision', settings, installed)
          if (visionModel && !(installed.find((m) => m.name === visionModel)?.capabilities ?? []).includes('vision')) visionModel = null
          visionModel ??= installed.find((m) => (m.capabilities ?? []).includes('vision'))?.name ?? null
          if (!visionModel) {
            visionNotes.push(
              'NOTE: No vision-capable model is installed, so the attached image could not be analysed. Tell the user to install one (e.g. qwen2.5vl:3b) in Settings → Models, and answer from the text alone.'
            )
            meta.steps!.push('No vision model installed')
          } else {
            await this.ensureResident(visionModel, settings, status)
            for (const a of images) {
              status(`Reading ${a.name} with ${visionModel}…`)
              const b64 = getImageBase64(a.id)
              if (!b64) continue
              const desc = await this.ollama.complete(
                visionModel,
                [
                  {
                    role: 'user',
                    content:
                      `You are the vision component of a programming assistant. Look at this image carefully.\n` +
                      `1. Transcribe ALL visible text exactly: code (with line numbers if shown), error messages, stack traces, file names, terminal output, UI labels.\n` +
                      `2. Describe what the image shows (IDE, terminal, web page, diagram, assignment, etc.).\n` +
                      `3. If there is an error or problem, state it precisely.\n` +
                      `The user's question about it is: "${req.text.slice(0, 500)}"`,
                    images: [b64]
                  }
                ],
                { temperature: 0.1, num_ctx: Math.min(settings.numCtx, 8192), num_predict: 1200 },
                ctrl.signal,
                settings.keepAlive
              )
              visionNotes.push(`${a.name}:\n${desc.trim()}`)
            }
            meta.models!.push(visionModel)
            meta.steps!.push(`Analysed ${images.length} image(s) with ${visionModel}`)
            if (!req.regenerate) memory.updateMessageMeta(userMessage.id, { visionNotes: visionNotes.join('\n\n').slice(0, 6000) })
          }
        }
      }

      // ---- A freshly extracted ZIP: index it now so retrieval sees it in this answer ----
      const ws = getWorkspaceRoot()
      if (ws && attachments.some((a) => a.kind === 'zip')) {
        status('Indexing the extracted project…')
        await this.indexer.index(ws).catch(() => undefined)
      }

      // ---- Earlier document attachments in this conversation (for follow-ups) ----
      const priorIds = [...new Set(history.flatMap((m) => (m.attachments ?? []).filter((a) => a.kind === 'pdf' || a.kind === 'text').map((a) => a.id)))].slice(-3)
      const priorAttachments = getAttachments(priorIds)
      if (!visionNotes.length) {
        const lastVision = [...history].reverse().find((m) => m.meta?.visionNotes)
        if (lastVision && /\b(image|screenshot|picture|it|that|this)\b/i.test(req.text)) visionNotes.push(`(from an earlier screenshot) ${lastVision.meta!.visionNotes}`)
      }

      // ---- Knowledge library (syllabus, notes): retrieved per request ----
      let knowledgeBlock: { text: string; library: string[] } | undefined
      const libraryDocs = settings.knowledgeEnabled ? this.knowledge.activeDocs() : []
      if (libraryDocs.length) {
        status('Checking your knowledge library…')
        const prevUser = [...history].reverse().find((m) => m.role === 'user')
        // Short follow-ups ("explain that more") borrow the previous question for retrieval.
        const followUp = isFollowUp(req.text)
        const query = followUp && prevUser ? `${prevUser.content.slice(0, 300)}\n${req.text}` : req.text
        const total = settings.numCtx * 3.2 * 0.72
        const share = /\b(syllabus|curriculum|course|unit|module|notes|reference|textbook|according to|as per|exam|marks|outcome|slides?)\b/i.test(req.text)
          ? 0.35
          : route === 'reasoning' || route === 'code' || route === 'debug' || route === 'document'
            ? 0.3 // hard DSA questions lean on the course material
            : 0.22
        const { hits, semantic } = await this.knowledge.search(query, Math.floor(total * share), { sectionQuery: req.text, explicit: EXPLICIT_REF.test(query) }).catch(() => ({ hits: [], semantic: false }))
        if (hits.length) {
          knowledgeBlock = {
            text: hits.map((h) => `[${h.docName}${h.page ? ' p.' + h.page : ''}]\n${h.content}`).join('\n\n'),
            library: libraryDocs.map((d) => d.name)
          }
          meta.steps!.push(`Library (${semantic ? 'semantic + keyword' : 'keyword'}): ${[...new Set(hits.map((h) => h.docName + (h.page ? ' p.' + h.page : ' section')))].join(', ')}`)
        } else {
          knowledgeBlock = { text: '', library: libraryDocs.map((d) => d.name) }
        }
      }

      // ---- Main model with a bounded read-only agent loop ----
      await this.ensureResident(mainModel, settings, status)
      if (!meta.models!.includes(mainModel)) meta.models!.push(mainModel)
      const think = route === 'reasoning' && mainCaps.includes('thinking') ? true : mainCaps.includes('thinking') ? false : undefined
      let toolResults = ''
      // Thinking budget from Settings → Reasoning depth.
      const REASONING_BUDGET = Math.min(24576, Math.max(4096, settings.reasoningBudget || 12288))
      let reasoningMessages: OllamaChatMessage[] | null = null
      let reasoningCtx = settings.numCtx
      const maxSteps = Math.max(1, Math.min(8, settings.maxAgentSteps))
      for (let step = 0; step < maxSteps; step++) {
        const built = buildContext({
          req,
          numCtx: settings.numCtx,
          history,
          summary: conv.summary,
          attachments,
          priorAttachments,
          visionNotes,
          images: directImages,
          indexer: this.indexer,
          tree: req.context.workspace ? this.getTree() : null,
          route: route as Route,
          toolResults: toolResults || undefined,
          knowledge: knowledgeBlock
        })
        if (step === 0 && built.included.length) meta.steps!.push('Context: ' + built.included.join(', '))
        // Thinking models follow DeepSeek's guidance for R1: no system prompt (everything goes in the
        // user turn), temperature 0.6, top_p 0.95 — and a context window large enough for the prompt
        // plus the whole thinking budget plus the answer, so the question is never pushed out.
        const REASONING_TOKEN_CAP = REASONING_BUDGET
        const messages: OllamaChatMessage[] = think ? toReasoningMessages(built.messages) : built.messages
        const promptTokens = estimateTokens(messages)
        const numCtx = think
          ? Math.min(MAX_REASONING_CTX, Math.max(settings.numCtx, Math.ceil((promptTokens + REASONING_TOKEN_CAP + ANSWER_TOKENS) / 1024) * 1024))
          : settings.numCtx
        if (think && step === 0) {
          reasoningMessages = messages
          reasoningCtx = numCtx
        }
        if (think && step === 0) meta.steps!.push(`Reasoning: context ${numCtx} tokens (prompt ≈${promptTokens} + thinking budget ${REASONING_TOKEN_CAP} + answer ${ANSWER_TOKENS})`)
        status(step === 0 ? `Thinking with ${mainModel}…` : `Continuing with ${mainModel}…`)
        let stepText = ''
        // deepseek-r1 is tuned for temperature ~0.6; code and fixes stay deterministic.
        const temperature = think ? 0.6 : route === 'code' || route === 'debug' ? Math.min(settings.temperature, 0.3) : settings.temperature
        const topP = think ? 0.95 : settings.topP
        // Cap generation so a model can never run on indefinitely.
        const numPredict = think ? REASONING_TOKEN_CAP + ANSWER_TOKENS : Math.max(1024, Math.floor(settings.numCtx * 0.6))
        const onToken = (t: string) => {
          stepText += t
          this.emit({ type: 'token', ...ev, text: t })
        }
        // Guards on the thinking stream: the token budget, and a detector for degenerate loops
        // (it only fires on sustained >=50% repetition, well above normal restating).
        const stepCtrl = new AbortController()
        const relayAbort = () => stepCtrl.abort()
        ctrl.signal.addEventListener('abort', relayAbort)
        const loops = new RepetitionMonitor()
        let thinkStop: 'budget' | 'loop' | null = null
        let stepThinking = ''
        let thinkTokens = 0 // Ollama streams about one token per chunk
        let r: { content: string; thinking: string }
        try {
          r = await this.ollama.chat({
            model: mainModel,
            messages,
            options: { num_ctx: numCtx, temperature, top_p: topP, num_predict: numPredict },
            keepAlive: settings.keepAlive,
            onRetry,
            think,
            signal: stepCtrl.signal,
            onToken,
            onThinking: (t) => {
              thinking += t
              stepThinking += t
              this.emit({ type: 'thinking', ...ev, text: t })
              if (!think || thinkStop) return
              thinkTokens++
              if (thinkTokens > REASONING_TOKEN_CAP) thinkStop = 'budget'
              else if (loops.push(t)) thinkStop = 'loop'
              if (thinkStop) stepCtrl.abort()
            }
          })
        } catch (e) {
          if (!thinkStop || ctrl.signal.aborted) throw e
          r = { content: stepText, thinking: stepThinking }
        } finally {
          ctrl.signal.removeEventListener('abort', relayAbort)
        }
        if (think && (thinkStop || !r.content.trim()) && !ctrl.signal.aborted) {
          // 1) Let the same reasoning model finish from its own notes with a short extra thinking
          //    budget (it often only needs to verify and conclude — handing over to a weaker model
          //    at this point threw away a self-correction in testing).
          status(`Finishing the answer with ${mainModel}…`)
          const notes = thinking.slice(-14000)
          const finishMsgs: OllamaChatMessage[] = [
            {
              role: 'user',
              content: `${req.text}\n\nYour reasoning so far (it may be unfinished):\n${notes}\n\nMost of the work is done. Check the key steps once (correct any mistake you find), then give the final answer${CODE_ANSWER_RE.test(req.text) ? ' with complete, working code' : ''}. Do not start over.`
            }
          ]
          const finCtrl = new AbortController()
          const relayFin = () => finCtrl.abort()
          ctrl.signal.addEventListener('abort', relayFin)
          let finThink = 0
          let finText = ''
          try {
            const fin = await this.ollama.chat({
              model: mainModel,
              messages: finishMsgs,
              options: { num_ctx: Math.min(MAX_REASONING_CTX, Math.ceil((estimateTokens(finishMsgs) + FINISH_THINK_TOKENS + ANSWER_TOKENS) / 1024) * 1024), temperature, top_p: topP, num_predict: FINISH_THINK_TOKENS + ANSWER_TOKENS },
              keepAlive: settings.keepAlive,
              onRetry,
              think,
              signal: finCtrl.signal,
              onToken: (t) => {
                finText += t
                onToken(t)
              },
              onThinking: (t) => {
                thinking += t
                this.emit({ type: 'thinking', ...ev, text: t })
                if (++finThink > FINISH_THINK_TOKENS) finCtrl.abort()
              }
            })
            if (fin.content.trim()) {
              r = fin
              meta.steps!.push(`Reasoning ${(thinkStop as string | null) === 'loop' ? 'started repeating itself' : `used its full ${REASONING_TOKEN_CAP}-token budget`}; ${mainModel} then finished from its own notes`)
            }
          } catch (e) {
            if (ctrl.signal.aborted) throw e
          } finally {
            ctrl.signal.removeEventListener('abort', relayFin)
          }
        }
        if (think && !r.content.trim() && !ctrl.signal.aborted) {
          // 2) Still no answer: a second model writes the final answer from the reasoning — the
          //    coding model when code is asked for.
          const wantsCode = CODE_ANSWER_RE.test(req.text)
          const writer = (wantsCode ? this.pick('coder', settings, installed) : this.pick('general', settings, installed)) ?? mainModel
          meta.steps!.push(
            thinkStop === 'loop'
              ? `Reasoning started repeating itself (${Math.round(loops.lastOverlap * 100)}% repeated); ${writer} wrote the final answer from it`
              : `Reasoning used its full ${REASONING_TOKEN_CAP}-token budget; ${writer} wrote the final answer from it`
          )
          status(`Writing the final answer with ${writer}…`)
          await this.ensureResident(writer, settings, status)
          if (!meta.models!.includes(writer)) meta.models!.push(writer)
          const writerCaps = installed.find((m) => m.name === writer)?.capabilities ?? []
          const draft = thinking.slice(-14000)
          r = await this.ollama.chat({
            model: writer,
            messages: [
              {
                role: 'system',
                content:
                  'You write the final answer from a reasoning model\'s notes. The notes may be unfinished or repetitive: keep their correct conclusions, check them, fix any mistakes, and do not repeat the deliberation. ' +
                  'Answer with: the approach in a few clear steps, time and space complexity, and complete, working code when code is requested.'
              },
              { role: 'user', content: `Question:\n${req.text}\n\nReasoning notes:\n${draft}\n\nWrite the final answer.` }
            ],
            options: { num_ctx: Math.max(settings.numCtx, Math.ceil((estimateTokens([{ role: 'user', content: draft + req.text }]) + 3072) / 1024) * 1024), temperature: 0.3, top_p: settings.topP, num_predict: 3072 },
            keepAlive: settings.keepAlive,
            onRetry,
            think: writerCaps.includes('thinking') ? false : undefined,
            signal: ctrl.signal,
            onToken
          })
        }        content += r.content
        const parsed = parseActions(r.content)
        const reads = parsed.actions.filter((a) => a.type === 'read_file' || a.type === 'search_files')
        const writes = parsed.actions.filter((a) => a.type !== 'read_file' && a.type !== 'search_files')
        if (!reads.length || writes.length || !req.context.workspace || step === maxSteps - 1) break
        // Execute read-only actions automatically and continue.
        const results: string[] = []
        for (const a of reads.slice(0, 6)) {
          if (a.type === 'read_file') {
            try {
              const abs = resolveInWorkspace(a.path)
              const text = fs.readFileSync(abs, 'utf8')
              results.push(`--- ${toRelative(abs)} ---\n${text.slice(0, 20000)}`)
              meta.steps!.push(`Read ${toRelative(abs)}`)
              status(`Reading ${toRelative(abs)}…`)
            } catch (e) {
              results.push(`--- ${a.path} --- ERROR: ${(e as Error).message}`)
            }
          } else if (a.type === 'search_files') {
            const hits = await searchWorkspace(a.query, {}, 60).catch(() => [])
            const ws = getWorkspaceRoot()!
            results.push(`Search "${a.query}":\n` + (hits.length ? hits.map((h) => `${path.relative(ws, h.path)}:${h.line}: ${h.text.trim()}`).join('\n') : 'no matches'))
            meta.steps!.push(`Searched "${a.query}"`)
            status(`Searching for "${a.query}"…`)
          }
        }
        toolResults += results.join('\n\n') + '\n\n'
        const sep = '\n\n'
        content += sep
        this.emit({ type: 'token', ...ev, text: sep })
        // Keep the conversation coherent for the next step.
        history.push({ id: 'tmp', conversationId: req.conversationId, role: 'assistant', content: stepText, createdAt: Date.now() })
        history.push({ id: 'tmp2', conversationId: req.conversationId, role: 'user', content: 'Here are the results. Continue and answer my original request.', createdAt: Date.now() })
        // Strip the temporary pair afterwards so it is not persisted twice.
      }

      // ---- Compile check: verify generated C/C++/Java/Python and let the model repair errors ----
      const compileCheckContent = async (): Promise<void> => {
        // Repairs use the coding model on the reasoning route (no second long deliberation).
        const repairModel = route === 'reasoning' ? (this.pick('coder', settings, installed) ?? mainModel) : mainModel
        const repairCaps = installed.find((m) => m.name === repairModel)?.capabilities ?? []
        let files = collectCodeFiles(content)
        const named = files.some((f) => !f.name.startsWith('snippet'))
        for (let round = 1; round <= 2 && files.length; round++) {
          status(`Compiling the code to check it${round > 1 ? ' again' : ''}…`)
          const rep = await compileCheck(files)
          if (!rep.checked.length) break // no compiler installed for this language
          if (!rep.errors) {
            meta.steps!.push(`Compile check passed (${rep.checked.join(', ')})${round > 1 ? ' after repair' : ''}`)
            break
          }
          meta.steps!.push(`Compile check found errors (round ${round}); ${repairModel} is repairing them`)
          if (round === 2) {
            meta.steps!.push('Still not compiling after two repairs')
            const note = `\n\n> Compile check: the code still has errors after two automatic repairs:\n> \`${rep.errors.split('\n')[0].slice(0, 200)}\``
            content += note
            this.emit({ type: 'token', ...ev, text: note })
            break
          }
          status('Compiler found errors — fixing them…')
          const header = '\n\n---\n**Compile check found errors — corrected version:**\n\n'
          content += header
          this.emit({ type: 'token', ...ev, text: header })
          const listing = files.map((f) => `\`\`\`${f.lang}${named ? ` file=${f.name}` : ''}\n${f.content}\n\`\`\``).join('\n\n')
          if (repairModel !== mainModel || round === 1) await this.ensureResident(repairModel, settings, status)
          if (!meta.models!.includes(repairModel)) meta.models!.push(repairModel)
          const fix = await this.ollama.chat({
            model: repairModel,
            messages: [
              { role: 'system', content: 'You fix compile errors. Keep the same design and the same structure the user asked for; change only what is needed to compile correctly. Output every file in full.' },
              {
                role: 'user',
                content: `Original request: ${req.text}\n\nCode:\n${listing}\n\nCompiler errors:\n${rep.errors}\n\nReturn the corrected complete code${named ? ', each file as ```lang file=NAME with the same names' : ' as fenced code blocks'}. Briefly say what you fixed.`
              }
            ],
            options: { num_ctx: settings.numCtx, temperature: 0.2, top_p: settings.topP, num_predict: Math.max(1024, Math.floor(settings.numCtx * 0.6)) },
            keepAlive: settings.keepAlive,
            onRetry,
            think: repairCaps.includes('thinking') ? false : undefined,
            signal: ctrl.signal,
            onToken: (t) => this.emit({ type: 'token', ...ev, text: t })
          })
          content += fix.content
          const updated = new Map(files.map((f) => [f.name, f]))
          for (const f of collectCodeFiles(fix.content)) updated.set(f.name, f)
          files = named ? [...updated.values()] : collectCodeFiles(fix.content)
        }
      }
      if ((route === 'code' || route === 'debug' || route === 'document' || route === 'reasoning') && !ctrl.signal.aborted) await compileCheckContent()

      // ---- Verification (1): run the code on examples and edge cases (opt-in) ----
      const codeNow = collectCodeFiles(content)
      if (settings.testCode && !ctrl.signal.aborted && (route === 'code' || route === 'debug') && codeNow.some((f) => f.lang === 'cpp')) {
        await this.testAndRepairCode(req, content, settings, installed, status, onRetry, meta, ev, (extra) => {
          content += extra
          this.emit({ type: 'token', ...ev, text: extra })
        })
      }

      // ---- Verification (2): independent second solution for reasoning answers ----
      // The model solves the question again without seeing the first answer; if the final results
      // differ, a third independent attempt decides by majority.
      if (settings.doubleCheck && !ctrl.signal.aborted && think && route === 'reasoning' && reasoningMessages && content.trim()) {
        const solve = async (label: string): Promise<string | null> => {
          status(`Double-checking: ${label}…`)
          const sCtrl = new AbortController()
          const relayS = () => sCtrl.abort()
          ctrl.signal.addEventListener('abort', relayS)
          let n = 0
          try {
            const res = await this.ollama.chat({
              model: mainModel,
              messages: reasoningMessages!,
              options: { num_ctx: reasoningCtx, temperature: 0.6, top_p: 0.95, num_predict: REASONING_BUDGET + ANSWER_TOKENS },
              keepAlive: settings.keepAlive,
              onRetry,
              think: true,
              signal: sCtrl.signal,
              onThinking: () => {
                if (++n > REASONING_BUDGET) sCtrl.abort()
              }
            })
            return res.content.trim() ? res.content : null
          } catch (e) {
            if (ctrl.signal.aborted) throw e
            return null
          } finally {
            ctrl.signal.removeEventListener('abort', relayS)
          }
        }
        const same = async (x: string, y: string): Promise<boolean> => {
          const fx = finalAnswerOf(x)
          const fy = finalAnswerOf(y)
          if (fx && fy && normalizeFinal(fx) === normalizeFinal(fy)) return true
          const q = `Question:\n${req.text}\n\nResult A:\n${fx ?? x.slice(-2500)}\n\nResult B:\n${fy ?? y.slice(-2500)}\n\nDo A and B give the same final result (ignore wording and formatting)? Reply exactly SAME or DIFFERENT.`
          const res = await this.ollama.chat({ model: mainModel, messages: [{ role: 'user', content: q }], options: { num_ctx: 8192, temperature: 0.2, top_p: 0.95, num_predict: 3072 }, keepAlive: settings.keepAlive, onRetry, think: true, signal: ctrl.signal }).catch(() => null)
          return !!res && /\bSAME\b/i.test(res.content) && !/\bDIFFERENT\b/i.test(res.content)
        }
        const second = await solve('solving the question again independently')
        if (!second) {
          meta.steps!.push('Double-check: the independent second solution did not finish in time')
        } else if (await same(content, second)) {
          meta.steps!.push('Double-check: an independent second solution reached the same result')
        } else {
          const third = await solve('the two solutions disagree — a third independent attempt')
          const thirdMatchesFirst = third ? await same(content, third) : false
          const thirdMatchesSecond = third && !thirdMatchesFirst ? await same(second, third) : false
          if (thirdMatchesFirst) {
            meta.steps!.push('Double-check: 2 of 3 independent solutions agree with this answer')
          } else if (thirdMatchesSecond) {
            const header = '\n\n---\n**Double-check: two independent re-solutions agree on a different result — corrected answer:**\n\n'
            content += header + second
            this.emit({ type: 'token', ...ev, text: header + second })
            meta.steps!.push('Double-check: 2 of 3 independent solutions disagreed with the first answer; corrected')
          } else {
            const warn = '\n\n> ⚠️ Double-check: three independent attempts reached different results. Treat this answer with caution and verify it by hand.'
            content += warn
            this.emit({ type: 'token', ...ev, text: warn })
            meta.steps!.push('Double-check: independent attempts disagree (no majority)')
          }
        }
      }
      // ---- File actions → change set for review ----
      const { actions, errors } = parseActions(content)
      const writes = actions.filter((a) => a.type !== 'read_file' && a.type !== 'search_files')
      if (writes.length) {
        if (!req.context.workspace || !getWorkspaceRoot()) {
          meta.steps!.push('Files were proposed but no folder is open')
          content += '\n\n> Open a folder (Explorer → Open Folder) to let me write these files into a workspace.'
        } else {
          const built = buildChangeSet(req.conversationId, messageId, writes)
          errors.push(...built.errors)
          if (built.changeSet) {
            changeSet = built.changeSet
            meta.changeSetId = changeSet.id
            const auto = settings.autoApplyEdits && changeSet.items.every((i) => !i.destructive && (i.action.type === 'create_file' || i.action.type === 'edit_file'))
            if (auto) {
              const { cs, touched } = await applyChangeSet(changeSet.id, undefined, this.runner)
              changeSet = cs
              this.onFilesTouched(touched)
              meta.steps!.push('Changes applied automatically (auto-apply is on)')
            }
            if (req.context.workspace) {
              const files = changeSet.items.filter((i) => 'path' in i.action).map((i) => (i.action as { path: string }).path)
              if (files.length) appendProjectNote(req.context.workspace, `${new Date().toISOString().slice(0, 10)}: assistant proposed ${files.slice(0, 6).join(', ')}${files.length > 6 ? '…' : ''} for "${req.text.slice(0, 60)}"`)
            }
          }
        }
      }
      if (errors.length) meta.steps!.push(...errors.map((e) => `Skipped: ${e}`))
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError' || ctrl.signal.aborted) {
        meta.stopped = true
      } else {
        meta.error = err.message
      }
    } finally {
      this.active.delete(req.conversationId)
    }

    meta.durationMs = Date.now() - started
    if (thinking) meta.thinking = thinking.slice(0, 20000)
    const message: ChatMessage = {
      id: messageId,
      conversationId: req.conversationId,
      role: 'assistant',
      content,
      createdAt: Date.now(),
      model: usedModel || undefined,
      meta
    }
    memory.insertMessage(message)
    memory.touchConversation(req.conversationId)
    this.emit({ type: 'done', ...ev, message, changeSet })
    if (!meta.error && !meta.stopped) void this.maybeSummarize(req.conversationId, usedModel, settings)
  }

  /** Keep long conversations usable on small context windows by summarising older turns. */
  private async maybeSummarize(conversationId: string, model: string, settings: Settings): Promise<void> {
    try {
      const msgs = memory.getMessages(conversationId, false)
      const conv = memory.getConversation(conversationId)
      if (!conv || msgs.length < 10) return
      const totalChars = msgs.reduce((n, m) => n + m.content.length, 0)
      if (totalChars < settings.numCtx * 3.2 * 0.5) return
      const older = msgs.slice(0, -6)
      if (older.length <= conv.summaryUpto) return
      const transcript = older.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 1500)}`).join('\n\n').slice(-settings.numCtx * 2)
      const summary = await this.ollama.complete(
        model,
        [
          { role: 'system', content: 'Summarise this conversation for your own memory. Keep: the user goals, decisions, file names, errors found and fixes applied, open questions. Max 200 words, bullet points.' },
          { role: 'user', content: (conv.summary ? `Previous summary:\n${conv.summary}\n\n` : '') + transcript }
        ],
        { temperature: 0.2, num_ctx: settings.numCtx, num_predict: 600 },
        undefined,
        settings.keepAlive
      )
      if (summary.trim()) memory.setConversationSummary(conversationId, summary.trim(), older.length)
    } catch {
      /* summarisation is best effort */
    }
  }
}

export type { Attachment }
