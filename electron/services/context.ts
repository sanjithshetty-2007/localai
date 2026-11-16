import fs from 'node:fs'
import path from 'node:path'
import type { Attachment, ChatMessage, ChatRequest, FileNode } from '../../shared/types'
import type { OllamaChatMessage } from './ollama'
import { retrieveAttachmentText } from './documents'
import { getProjectMemory, treeToText, type ProjectIndexer } from './indexer'

export const CHARS_PER_TOKEN = 3.2

export type Route = 'general' | 'code' | 'reasoning' | 'vision' | 'document' | 'repository' | 'debug'

const CODE_RE = /\b(code|function|class|method|bug|error|exception|traceback|compile|syntax|debug|fix|refactor|implement|script|program|api|regex|sql|python|javascript|typescript|java|c\+\+|cpp|react|node|html|css|flask|django|json|variable|loop|array|import|module|test|unit test|stack ?trace|segfault|null|undefined|file|folder|project|repo|repository|build|run|npm|pip)\b|```|\.(py|js|ts|tsx|jsx|java|cpp|c|h|json|html|css|md)\b/i
const REASON_RE = /\b(prove|proof|complexity|big[- ]?o|algorithms?|dynamic programming|\bdp\b|recurrence|graph|tree traversal|shortest path|np[- ]hard|optimi[sz]e|leetcode|time limit|greedy|backtracking|binary search|math(?:ematical)?|derive|step[- ]by[- ]step|scheduling|deadlock|banker'?s|page replacement|gantt|turnaround|waiting time|solve|calculate|numerical|probability|equation|truth table|automata|regular expression to dfa)\b/i
// Requests to produce code or files stay with the coding model even when they mention algorithms.
const WRITE_CODE_RE = /\b(write|create|implement|build|generate|code|program|function|script|class|refactor|file|project|app)\b/i
const ERROR_RE = /\b(error|fail(?:ed|ing|s)?|crash|exception|traceback|not working|doesn'?t work|broken|wrong output|why)\b/i
const PROJECT_RE = /\b(project|repo|repository|codebase|architecture|structure|all files|whole|entire|across)\b/i

export function classify(req: ChatRequest, attachments: Attachment[]): { route: Route; role: 'general' | 'coder' | 'reasoning' } {
  const text = req.text
  if (req.kind === 'fix-request') return { route: 'debug', role: 'coder' }
  if (attachments.some((a) => a.kind === 'zip')) return { route: 'repository', role: 'coder' }
  const isReason = REASON_RE.test(text)
  const isCode = CODE_RE.test(text) || attachments.some((a) => a.kind === 'text') || !!req.context.selection
  if (attachments.some((a) => a.kind === 'image')) return { route: 'vision', role: isReason ? 'reasoning' : isCode || req.context.activeFile ? 'coder' : 'general' }
  if (attachments.some((a) => a.kind === 'pdf')) return { route: 'document', role: WRITE_CODE_RE.test(text) ? 'coder' : isReason ? 'reasoning' : 'general' }
  if (isReason && !WRITE_CODE_RE.test(text) && !/\b(fix|error|bug)\b/i.test(text)) return { route: 'reasoning', role: 'reasoning' }
  if (isCode) return { route: 'code', role: 'coder' }
  return { route: 'general', role: 'general' }
}

export function systemPrompt(hasWorkspace: boolean, workspaceName: string | null): string {
  const files = hasWorkspace
    ? `
## Writing files in the workspace ("${workspaceName}")
When the user asks you to create, write, change or fix files, output each file IN FULL inside a fenced code block whose info string is the language followed by file=<relative/path>:

\`\`\`python file=src/primes.py
<the complete file content>
\`\`\`

Rules for files:
- Always write the COMPLETE file. Never leave "..." or "rest of code unchanged" placeholders.
- Paths are relative to the workspace root and use forward slashes.
- Use a plain code block (no file=) for examples that should not be saved.
- Other operations use an action block holding JSON, one object or an array:
\`\`\`action
{"type": "delete_file", "path": "old.py"}
\`\`\`
  Supported: create_directory {path}, delete_file {path}, rename_file {from, to}, run_command {command, cwd?}.
  run_command takes ONE simple command (no pipes, &&, ; or redirects). Allowed programs: python, pip, node, npm, npx, g++, gcc, javac, java, git, tsc, pytest, flask.
- To look at project files you have not seen, emit \`\`\`action {"type": "read_file", "path": "..."}\`\`\` or {"type": "search_files", "query": "..."} and STOP. The results will be sent back to you.
- The user reviews every change in a diff and accepts or rejects it, so say you have *proposed* the changes. Never claim a file was saved or a command was run.
- After proposing runnable code, briefly say how to run it.`
    : `
## No folder is open
The user has not opened a workspace folder, so files cannot be written. Show code in normal fenced code blocks and, when they want files created, suggest opening a folder (File → Open Folder) first.`
  return `You are LocalCode AI, the single built-in assistant of LocalCode AI Studio, a local, offline desktop IDE. You run entirely on the user's machine through Ollama.
You help with everything in one conversation: general questions, programming, algorithms, debugging, explaining code, reading screenshots, PDFs and whole repositories, writing files and fixing errors.

Style:
- Be direct and accurate. Use Markdown. Put code in fenced blocks with a language tag.
- Use the context provided (open file, selection, terminal output, attachments, project files, earlier messages). Do not ask the user to paste things that are already in the context.
- If something is missing or uncertain, say so plainly instead of inventing it.
- For debugging: name the cause, point to the line, explain briefly, then give the fix.
- For data structures and algorithms: implement exactly the structure or algorithm that was named, with all of its defining operations (an expression tree is built from postfix with a stack and can be evaluated; a threaded binary tree uses thread flags and is traversed without a stack). Never substitute a simpler or different structure. Write complete, compilable code with a main() demo.
- When a "Reference library" block is present it is the user's own material (for example their syllabus). Treat it as the reference: match its topics, units, terminology and scope, cite the source like [syllabus.pdf p.3], and say clearly when the library does not cover something before answering from general knowledge.
${files}`
}

function clip(text: string, max: number, label = 'truncated'): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n… [${label}: ${text.length - max} more characters]`
}

function windowAround(content: string, centerLine: number, maxChars: number): string {
  const lines = content.split('\n')
  let start = Math.max(0, centerLine - 1)
  let end = start + 1
  let size = (lines[start] ?? '').length
  while (size < maxChars && (start > 0 || end < lines.length)) {
    if (start > 0) size += lines[--start].length + 1
    if (end < lines.length && size < maxChars) size += lines[end++].length + 1
  }
  return lines
    .slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(4)}| ${l}`)
    .join('\n')
}

function withLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4)}| ${l}`)
    .join('\n')
}

const ZIP_TEXT_EXT = /\.(py|js|mjs|cjs|ts|tsx|jsx|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|html|css|scss|json|md|txt|toml|yml|yaml|ini|cfg|sql|sh|xml|gradle|kt|swift)$/i
const ZIP_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '__pycache__', '.venv', 'venv', 'target', '.next'])

/** File tree plus the contents of the most useful files of an extracted archive, within a budget. */
export function describeExtracted(dir: string, budget: number, rel: (p: string) => string): string {
  const files: string[] = []
  const walk = (d: string, depth: number) => {
    if (files.length >= 400 || depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (!ZIP_SKIP_DIRS.has(e.name)) walk(full, depth + 1)
      } else if (e.isFile()) files.push(full)
    }
  }
  walk(dir, 0)
  const tree = files.map((f) => path.relative(dir, f).split(path.sep).join('/')).join('\n')
  const parts = [`Files:\n${tree.slice(0, Math.floor(budget * 0.25))}`]
  let used = parts[0].length
  const score = (f: string) => (/readme/i.test(f) ? 0 : /(main|app|server|index|__init__)\.\w+$/i.test(f) ? 1 : /\.(json|toml|txt|ya?ml)$/i.test(f) ? 3 : 2)
  for (const f of files.filter((x) => ZIP_TEXT_EXT.test(x) || /readme/i.test(x)).sort((a, b) => score(a) - score(b))) {
    let text: string
    try {
      if (fs.statSync(f).size > 200_000) continue
      text = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    const piece = `--- ${rel(f)} ---\n${text.length > 6000 ? text.slice(0, 6000) + '\n…' : text}`
    if (used + piece.length > budget) continue
    parts.push(piece)
    used += piece.length
  }
  return parts.join('\n\n')
}

export interface BuiltContext {
  messages: OllamaChatMessage[]
  contextChars: number
  included: string[]
}

export interface ContextInputs {
  req: ChatRequest
  numCtx: number
  history: ChatMessage[] // previous messages, oldest first, excluding the current user message
  summary: string | null
  attachments: Attachment[] // attachments on the current message
  priorAttachments: Attachment[] // documents attached earlier in the conversation
  visionNotes: string[]
  images: string[] // base64 images to send directly to the model (when it is vision-capable)
  indexer: ProjectIndexer
  tree: FileNode | null
  route: Route
  toolResults?: string
  knowledge?: { text: string; library: string[] }
}

/** Assemble the prompt under a character budget derived from the model context size. */
export function buildContext(inp: ContextInputs): BuiltContext {
  const { req, numCtx } = inp
  const ctx = req.context
  const total = Math.floor(numCtx * CHARS_PER_TOKEN * 0.72) // leave room for the answer
  const ws = ctx.workspace
  const sys = systemPrompt(!!ws, ws ? path.basename(ws) : null)
  let budget = total - sys.length - req.text.length - 200
  const blocks: string[] = []
  const included: string[] = []
  const add = (title: string, body: string, max: number, tag?: string) => {
    if (!body.trim() || budget <= 200) return
    const b = clip(body, Math.min(max, budget - 100))
    blocks.push(`### ${title}\n${b}`)
    budget -= b.length + title.length + 6
    included.push(tag ?? title)
  }
  const rel = (p: string) => (ws ? path.relative(ws, p).split(path.sep).join('/') : p)
  const failing = ctx.lastRun && ctx.lastRun.status !== 'success'
  const wantsError = req.kind === 'fix-request' || ERROR_RE.test(req.text)

  // 1. Project memory
  if (ws) {
    const mem = getProjectMemory(ws)
    if (mem) add('Project memory', [mem.summary, mem.notes ? 'Notes:\n' + mem.notes : ''].filter(Boolean).join('\n'), 1800, 'project memory')
  }

  // 1b. The user's knowledge library (syllabus, notes): retrieved excerpts
  if (inp.knowledge) {
    const k = inp.knowledge
    const header = `Library documents: ${k.library.join(', ')}`
    add(
      'Reference library (the user\'s own course material — authoritative; cite as [file p.N])',
      k.text ? `${header}\n\n${k.text}` : `${header}\n(No passage in the library matched this request.)`,
      Math.floor(total * 0.36),
      'knowledge library'
    )
  }

  // 2. Errors from the last run
  if (ctx.lastRun && (wantsError || req.kind === 'fix-request') && failing) {
    const r = ctx.lastRun
    const probs = r.problems.map((p) => `${rel(p.file)}:${p.line}${p.column ? ':' + p.column : ''} ${p.severity}: ${p.message}`).join('\n')
    add(
      `Last run of ${rel(r.file)} FAILED (exit code ${r.exitCode ?? 'none'}, status ${r.status})`,
      `Command: ${r.command}\n${probs ? 'Parsed problems:\n' + probs + '\n' : ''}stderr:\n${r.stderr.slice(-3500)}\nstdout (tail):\n${r.stdout.slice(-1200)}`,
      5500,
      'last run error'
    )
  } else if (ctx.lastRun && /\b(output|result|ran|run)\b/i.test(req.text)) {
    const r = ctx.lastRun
    add(`Last run of ${rel(r.file)} (exit ${r.exitCode})`, `stdout:\n${r.stdout.slice(-2000)}\nstderr:\n${r.stderr.slice(-1000)}`, 3200, 'last run')
  }

  // 3. Selection and active file
  if (ctx.selection?.text.trim()) {
    add(`Selected code (lines ${ctx.selection.startLine}-${ctx.selection.endLine} of ${ctx.activeFile ? rel(ctx.activeFile.path) : 'editor'})`, ctx.selection.text, Math.floor(total * 0.18), 'selection')
  }
  if (ctx.activeFile) {
    const f = ctx.activeFile
    const max = Math.floor(total * (inp.route === 'general' ? 0.15 : 0.35))
    const errLine = ctx.lastRun?.problems.find((p) => path.resolve(p.file) === path.resolve(f.path))?.line
    const center = errLine ?? ctx.selection?.startLine
    const body =
      f.content.length + f.content.split('\n').length * 6 <= max
        ? withLineNumbers(f.content)
        : center
          ? windowAround(f.content, center, max)
          : clip(withLineNumbers(f.content), max)
    add(`Active file: ${rel(f.path)} (${f.language}${f.dirty ? ', unsaved changes' : ''}) — line numbers are for reference only, do not include them in code you write`, body, max, 'active file')
  }

  // 4. Attachments on this message
  const textAtts = inp.attachments.filter((a) => a.kind === 'pdf' || a.kind === 'text')
  if (textAtts.length) {
    const per = Math.floor((total * 0.4) / textAtts.length)
    for (const a of textAtts) {
      const { text, partial } = retrieveAttachmentText(a.id, req.text, Math.min(per, budget - 300))
      const label = a.kind === 'pdf' ? `PDF "${a.name}" (${a.pages} pages${partial ? ', relevant excerpts' : ''})` : `Attached file "${a.name}"`
      add(label, text || a.note || '(no extractable text)', per, a.name)
    }
  }
  for (const a of inp.attachments.filter((x) => x.kind === 'zip')) {
    const body = a.extractedTo ? describeExtracted(a.extractedTo, Math.floor(total * 0.4), rel) : ''
    add(`ZIP "${a.name}" extracted to ${a.extractedTo ? rel(a.extractedTo) : '?'} (${a.fileCount} files)`, body || 'The archive was extracted and indexed.', Math.floor(total * 0.42), a.name)
  }
  for (const note of inp.visionNotes) add('Image analysis (from the local vision model)', note, 4000, 'image analysis')

  // 5. Documents attached earlier, for follow-up questions
  if (!textAtts.length && inp.priorAttachments.length) {
    const per = Math.floor((total * 0.25) / inp.priorAttachments.length)
    for (const a of inp.priorAttachments) {
      const { text } = retrieveAttachmentText(a.id, req.text, Math.min(per, Math.max(0, budget - 300)))
      if (text) add(`Earlier attachment "${a.name}" (relevant excerpts)`, text, per, a.name)
    }
  }

  // 6. Tool results from the agent loop
  if (inp.toolResults) add('Results of your requested file reads/searches', inp.toolResults, Math.floor(total * 0.35), 'tool results')

  // 7. Relevant project files from the index
  if (ws && inp.route !== 'general' && inp.route !== 'reasoning') {
    const exclude = new Set<string>(ctx.activeFile ? [rel(ctx.activeFile.path)] : [])
    const q = req.text + (failing ? ' ' + (ctx.lastRun?.problems.map((p) => p.message).join(' ') ?? '') : '')
    const share = PROJECT_RE.test(req.text) || inp.route === 'repository' ? 0.3 : 0.15
    const chunks = inp.indexer.search(ws, q, Math.min(Math.floor(total * share), Math.max(0, budget - 1500)), exclude)
    if (chunks.length) {
      add(
        'Relevant project files (from the local index)',
        chunks.map((c) => `--- ${c.path} (from line ${c.startLine}) ---\n${c.content}`).join('\n\n'),
        Math.floor(total * share),
        'project index'
      )
    }
    if (inp.tree) add('Workspace file tree', treeToText(inp.tree, ws, inp.route === 'repository' || PROJECT_RE.test(req.text) ? 250 : 80), 4000, 'file tree')
    if (ctx.openFiles.length) add('Open editor tabs', ctx.openFiles.map(rel).join('\n'), 800, 'open tabs')
  }

  // 8. Terminal output when relevant
  if (ctx.terminalOutput && (wantsError || /\bterminal|output|console\b/i.test(req.text))) {
    add('Recent terminal output', ctx.terminalOutput.slice(-2500), 2600, 'terminal')
  }

  // 9. Conversation history, newest first until the budget is spent
  const history: OllamaChatMessage[] = []
  const recent = [...inp.history].reverse()
  for (const m of recent) {
    let content = m.content
    if (m.role === 'user' && m.meta?.visionNotes) content += `\n[Image analysis: ${m.meta.visionNotes.slice(0, 1500)}]`
    if (m.role === 'user' && m.attachments?.length) content += `\n[Attached: ${m.attachments.map((a) => a.name).filter(Boolean).join(', ')}]`
    if (m.meta?.error && !content) continue
    content = clip(content, 6000, 'older message truncated')
    if (content.length + 20 > budget) break
    history.unshift({ role: m.role, content })
    budget -= content.length + 20
  }
  const dropped = inp.history.length - history.length

  const contextText = blocks.length ? `# Context\n${blocks.join('\n\n')}\n\n# Request\n` : ''
  const messages: OllamaChatMessage[] = [{ role: 'system', content: sys }]
  if (inp.summary && dropped > 0) messages.push({ role: 'system', content: `Summary of the earlier conversation:\n${inp.summary}` })
  messages.push(...history)
  const userMsg: OllamaChatMessage = { role: 'user', content: contextText + req.text }
  if (inp.images.length) userMsg.images = inp.images
  messages.push(userMsg)
  return { messages, contextChars: contextText.length, included }
}
