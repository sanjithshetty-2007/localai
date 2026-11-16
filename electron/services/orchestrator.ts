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
import { collectCodeFiles, compileCheck } from './compile-check'
import * as memory from './memory'

type Role = 'general' | 'coder' | 'reasoning' | 'vision'

const FILLER = new Set('a an the and or but so to of in on for with is are was be it its that this those these them they he she do does did can could would should will please me my i you your we our what why how which who when where about more elaborate explain example examples again also same above previous continue tell show give detail details further elaborate one some any just like there here then than'.split(' '))

/** A follow-up has almost no new content words ("explain that more", "why?", "give an example"). */
export function isFollowUp(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return words.length > 0 && words.length <= 12 && words.filter((w) => !FILLER.has(w)).length <= 1
}

const EMBED_RE = /embed|bge|nomic|minilm|e5-/i
// Thinking models (deepseek-r1, qwen3) get a bounded reasoning budget (~1.5 min on an 8 GB GPU).
const REASONING_TOKEN_CAP = 6000

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
    try {
      const running = await this.ollama.ps()
      for (const r of running) {
        // Embedding models are tiny and shared with the library; never evict them.
        if (r.name !== model && !EMBED_RE.test(r.name) && r.name.split(':')[0] !== settings.roles.embedding.split(':')[0]) {
          status(`Unloading ${r.name} to free memory…`)
          await this.ollama.unload(r.name).catch(() => undefined)
        }
      }
      if (!running.some((r) => r.name === model)) status(`Loading ${model}…`)
    } catch {
      /* ps unsupported: continue */
    }
  }

  async send(req: ChatRequest): Promise<void> {
    if (this.active.has(req.conversationId)) throw new Error('The assistant is already answering in this conversation.')
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
        const messages: OllamaChatMessage[] = built.messages
        status(step === 0 ? `Thinking with ${mainModel}…` : `Continuing with ${mainModel}…`)
        let stepText = ''
        // deepseek-r1 is tuned for temperature ~0.6; code and fixes stay deterministic.
        const temperature = think ? 0.6 : route === 'code' || route === 'debug' ? Math.min(settings.temperature, 0.3) : settings.temperature
        // Cap generation so a model can never run on indefinitely (Ollama shifts the context window past num_ctx).
        const numPredict = think ? REASONING_TOKEN_CAP : Math.max(1024, Math.floor(settings.numCtx * 0.6))
        const onToken = (t: string) => {
          stepText += t
          this.emit({ type: 'token', ...ev, text: t })
        }
        let r = await this.ollama.chat({
          model: mainModel,
          messages,
          options: { num_ctx: settings.numCtx, temperature, top_p: settings.topP, num_predict: numPredict },
          keepAlive: settings.keepAlive,
          think,
          signal: ctrl.signal,
          onToken,
          onThinking: (t) => {
            thinking += t
            this.emit({ type: 'thinking', ...ev, text: t })
          }
        })
        if (think && !r.content.trim()) {
          // The reasoning budget ran out before an answer: the conversation model writes the
          // final answer from the reasoning so far (one combined reply, two models).
          const writer = this.pick('general', settings, installed) ?? mainModel
          meta.steps!.push(`Reasoning reached ${REASONING_TOKEN_CAP} tokens; ${writer} wrote the final answer from it`)
          status(`Reasoning ran long — ${writer} is writing the answer…`)
          await this.ensureResident(writer, settings, status)
          if (!meta.models!.includes(writer)) meta.models!.push(writer)
          const writerCaps = installed.find((m) => m.name === writer)?.capabilities ?? []
          r = await this.ollama.chat({
            model: writer,
            messages: [
              { role: 'system', content: 'You turn a draft line of reasoning into a clear, correct final answer. Check the reasoning, fix any mistakes, and show the key steps briefly.' },
              { role: 'user', content: `Question:\n${req.text}\n\nDraft reasoning (may be unfinished):\n${thinking.slice(-12000)}\n\nWrite the final answer.` }
            ],
            options: { num_ctx: settings.numCtx, temperature: 0.3, top_p: settings.topP, num_predict: 2048 },
            keepAlive: settings.keepAlive,
            think: writerCaps.includes('thinking') ? false : undefined,
            signal: ctrl.signal,
            onToken
          })
        }
        content += r.content
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
      if ((route === 'code' || route === 'debug' || route === 'document') && !ctrl.signal.aborted) {
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
          meta.steps!.push(`Compile check found errors (round ${round}); ${mainModel} is repairing them`)
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
          const fix = await this.ollama.chat({
            model: mainModel,
            messages: [
              { role: 'system', content: 'You fix compile errors. Keep the same design and the same structure the user asked for; change only what is needed to compile correctly. Output every file in full.' },
              {
                role: 'user',
                content: `Original request: ${req.text}\n\nCode:\n${listing}\n\nCompiler errors:\n${rep.errors}\n\nReturn the corrected complete code${named ? ', each file as ```lang file=NAME with the same names' : ' as fenced code blocks'}. Briefly say what you fixed.`
              }
            ],
            options: { num_ctx: settings.numCtx, temperature: 0.2, top_p: settings.topP, num_predict: Math.max(1024, Math.floor(settings.numCtx * 0.6)) },
            keepAlive: settings.keepAlive,
            think: mainCaps.includes('thinking') ? false : undefined,
            signal: ctrl.signal,
            onToken: (t) => this.emit({ type: 'token', ...ev, text: t })
          })
          content += fix.content
          const updated = new Map(files.map((f) => [f.name, f]))
          for (const f of collectCodeFiles(fix.content)) updated.set(f.name, f)
          files = named ? [...updated.values()] : collectCodeFiles(fix.content)
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
