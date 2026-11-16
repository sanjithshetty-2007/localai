import { create } from 'zustand'
import type {
  Attachment,
  ChangeSet,
  ChatEvent,
  ChatMessage,
  Conversation,
  EditorContext,
  FileNode,
  HardwareInfo,
  IndexStatus,
  KnowledgeDoc,
  KnowledgeProgress,
  OllamaStatus,
  PullProgress,
  RunEvent,
  RunProblem,
  RunResult,
  Settings
} from '@shared/types'
import { api, basename, errorMessage, languageFor, relativePath, samePath, stripAnsi } from '@/lib/api'
import { disposeModel, getModel, replaceModelText } from '@/editor/monaco'

export type SideView = 'explorer' | 'search' | 'run' | 'knowledge'
export type PanelTab = 'terminal' | 'output' | 'problems' | 'debug'

export interface FileTab {
  id: string
  kind: 'file'
  path: string
  name: string
  language: string
  content: string
  saved: string
  revealLine?: number
}
export interface DiffTab {
  id: string
  kind: 'diff'
  name: string
  path: string
  changeSetId: string
  itemId: string
  original: string
  proposed: string
  language: string
}
export interface SettingsTab {
  id: 'settings'
  kind: 'settings'
  name: string
}
export type Tab = FileTab | DiffTab | SettingsTab

export interface OutputLine {
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}
export interface LogEntry {
  time: number
  level: 'info' | 'warn' | 'error'
  text: string
}
export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}
export interface StreamState {
  messageId: string
  content: string
  thinking: string
  status: string
}
export interface Verification {
  status: 'running' | 'passed' | 'failed'
  exitCode?: number | null
  attempt: number
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  resolve: (ok: boolean) => void
}
export interface PromptRequest {
  title: string
  value: string
  placeholder?: string
  resolve: (value: string | null) => void
}

interface State {
  ready: boolean
  platform: string
  settings: Settings | null
  ollama: OllamaStatus | null
  hardware: HardwareInfo | null
  pulls: Record<string, PullProgress>
  indexStatus: IndexStatus | null

  workspace: string | null
  tree: FileNode | null
  expanded: Record<string, boolean>
  selectedPath: string | null

  tabs: Tab[]
  activeTabId: string | null
  selection: EditorContext['selection'] | null
  cursor: { line: number; column: number }

  view: SideView
  sidebarVisible: boolean
  panelVisible: boolean
  panelTab: PanelTab
  panelHeight: number
  sidebarWidth: number

  runId: string | null
  runFile: string | null
  runCommand: string
  output: OutputLine[]
  lastRun: RunResult | null
  problems: RunProblem[]
  logs: LogEntry[]
  terminalTail: string
  runToChangeSet: Record<string, string>
  verifications: Record<string, Verification>
  fixAttempts: Record<string, number>

  conversations: Conversation[]
  conversationId: string | null
  messages: ChatMessage[]
  stream: StreamState | null
  pendingAttachments: Attachment[]
  attaching: boolean
  changeSets: Record<string, ChangeSet>
  chatInputFocusTick: number
  chatDraft: string

  knowledgeDocs: KnowledgeDoc[]
  knowledgeProgress: Record<string, KnowledgeProgress>
  setupOpen: boolean

  toasts: Toast[]
  confirmReq: ConfirmRequest | null
  promptReq: PromptRequest | null
}

interface Actions {
  init(): Promise<void>
  toast(kind: Toast['kind'], text: string): void
  log(level: LogEntry['level'], text: string): void
  confirm(title: string, message: string, confirmLabel?: string, danger?: boolean): Promise<boolean>
  prompt(title: string, value?: string, placeholder?: string): Promise<string | null>
  updateSettings(patch: Partial<Settings>): Promise<void>
  toggleTheme(): void
  refreshOllama(): Promise<void>
  detectHardware(): Promise<void>

  openFolder(): Promise<void>
  openWorkspace(path: string): Promise<void>
  closeWorkspace(): Promise<void>
  refreshTree(): Promise<void>
  toggleExpanded(path: string, value?: boolean): void

  openFile(path: string, line?: number): Promise<void>
  openSettings(): void
  openDiff(cs: ChangeSet, itemId: string): void
  closeTab(id: string, force?: boolean): Promise<void>
  setActiveTab(id: string): void
  updateContent(path: string, content: string): void
  saveFile(path?: string): Promise<boolean>
  saveAs(): Promise<void>
  reloadOpenFiles(paths?: string[]): Promise<void>
  activeFile(): FileTab | null

  setView(v: SideView): void
  togglePanel(tab?: PanelTab): void
  runActiveFile(): Promise<void>
  runPath(path: string): Promise<void>
  stopRun(): Promise<void>
  sendStdin(text: string): void
  appendTerminal(data: string): void

  loadConversations(): Promise<void>
  selectConversation(id: string): Promise<void>
  newConversation(): Promise<void>
  deleteConversation(id: string): Promise<void>
  clearConversation(): Promise<void>
  sendMessage(text: string, kind?: 'chat' | 'fix-request'): Promise<void>
  regenerate(): Promise<void>
  stopGeneration(): Promise<void>
  fixWithAI(): Promise<void>
  addAttachments(paths: string[]): Promise<void>
  pickAttachments(): Promise<void>
  addImageData(name: string, dataUrl: string): Promise<void>
  removeAttachment(id: string): void
  focusChat(draft?: string): void

  loadChangeSet(id: string): Promise<ChangeSet | null>
  applyChanges(id: string, itemIds?: string[]): Promise<ChangeSet | null>
  rejectChanges(id: string, itemIds?: string[]): Promise<void>
  undoChanges(id: string): Promise<void>
  applyAndRun(id: string, file: string): Promise<void>
  proposeEdit(path: string, content: string): Promise<void>

  loadKnowledge(): Promise<void>
  addKnowledge(paths?: string[]): Promise<void>
}

let toastSeq = 0
let initStarted = false

function buildContext(s: State): EditorContext {
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  const file = tab?.kind === 'file' ? tab : tab?.kind === 'diff' ? (s.tabs.find((t) => t.kind === 'file' && samePath(t.path, tab.path)) as FileTab | undefined) : undefined
  return {
    workspace: s.workspace,
    activeFile: file ? { path: file.path, content: file.content, language: file.language, dirty: file.content !== file.saved } : undefined,
    selection: file && s.selection?.text ? s.selection : undefined,
    openFiles: s.tabs.filter((t): t is FileTab => t.kind === 'file').map((t) => t.path),
    terminalOutput: s.terminalTail ? stripAnsi(s.terminalTail).slice(-4000) : undefined,
    lastRun: s.lastRun ?? undefined
  }
}

export const useApp = create<State & Actions>((set, get) => ({
  ready: false,
  platform: 'win32',
  settings: null,
  ollama: null,
  hardware: null,
  pulls: {},
  indexStatus: null,
  workspace: null,
  tree: null,
  expanded: {},
  selectedPath: null,
  tabs: [],
  activeTabId: null,
  selection: null,
  cursor: { line: 1, column: 1 },
  view: 'explorer',
  sidebarVisible: true,
  panelVisible: true,
  panelTab: 'terminal',
  panelHeight: 240,
  sidebarWidth: 250,
  runId: null,
  runFile: null,
  runCommand: '',
  output: [],
  lastRun: null,
  problems: [],
  logs: [],
  terminalTail: '',
  runToChangeSet: {},
  verifications: {},
  fixAttempts: {},
  conversations: [],
  conversationId: null,
  messages: [],
  stream: null,
  pendingAttachments: [],
  attaching: false,
  changeSets: {},
  chatInputFocusTick: 0,
  chatDraft: '',
  knowledgeDocs: [],
  knowledgeProgress: {},
  setupOpen: false,
  toasts: [],
  confirmReq: null,
  promptReq: null,

  async init() {
    if (initStarted) return
    initStarted = true
    const [settings, info] = await Promise.all([api.settings.get(), api.app.info()])
    document.documentElement.dataset.theme = settings.theme
    set({ settings, platform: info.platform.split(' ')[0] })
    subscribeEvents(set, get)
    await get().loadConversations()
    void get().loadKnowledge()
    const ws = settings.lastWorkspace ?? settings.defaultWorkspace
    if (ws) {
      try {
        await get().openWorkspace(ws)
      } catch (e) {
        get().log('warn', `Could not reopen ${ws}: ${errorMessage(e)}`)
      }
    }
    set({ ready: true })
    // First launch on a new computer: open the setup wizard if Ollama or models are missing.
    if (!settings.setupDone) {
      void api.setup.status().then((st) => {
        if (!st.ollamaRunning || st.required.some((m) => !m.installed)) set({ setupOpen: true })
        else void get().updateSettings({ setupDone: true })
      }).catch(() => set({ setupOpen: true }))
    }
    void get().refreshOllama()
    void get().detectHardware()
    setInterval(() => void get().refreshOllama(), 15000)
  },

  toast(kind, text) {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500)
    if (kind === 'error') get().log('error', text)
  },
  log(level, text) {
    set((s) => ({ logs: [...s.logs.slice(-499), { time: Date.now(), level, text }] }))
  },
  confirm(title, message, confirmLabel = 'OK', danger = false) {
    return new Promise((resolve) => set({ confirmReq: { title, message, confirmLabel, danger, resolve: (ok) => { set({ confirmReq: null }); resolve(ok) } } }))
  },
  prompt(title, value = '', placeholder) {
    return new Promise((resolve) => set({ promptReq: { title, value, placeholder, resolve: (v) => { set({ promptReq: null }); resolve(v) } } }))
  },

  async updateSettings(patch) {
    try {
      const settings = await api.settings.set(patch)
      set({ settings })
      if (patch.theme) {
        document.documentElement.dataset.theme = patch.theme
        await api.app.setTheme(patch.theme)
      }
      if (patch.ollamaUrl) void get().refreshOllama()
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  toggleTheme() {
    const t = get().settings?.theme === 'dark' ? 'light' : 'dark'
    void get().updateSettings({ theme: t })
  },
  async refreshOllama() {
    try {
      const prev = get().ollama
      const status = await api.ollama.status()
      set({ ollama: status })
      if (prev && prev.connected !== status.connected) get().log(status.connected ? 'info' : 'warn', status.connected ? `Connected to Ollama ${status.version}` : `Lost connection to Ollama: ${status.error}`)
    } catch (e) {
      get().log('error', errorMessage(e))
    }
  },
  async detectHardware() {
    try {
      set({ hardware: await api.hardware.detect() })
    } catch (e) {
      get().log('warn', `Hardware detection failed: ${errorMessage(e)}`)
    }
  },

  // ---------- workspace ----------
  async openFolder() {
    const dir = await api.fs.pickFolder()
    if (dir) await get().openWorkspace(dir)
  },
  async openWorkspace(path) {
    try {
      const { root, tree } = await api.fs.openWorkspace(path)
      for (const t of get().tabs) if (t.kind === 'file') disposeModel(t.path)
      set({ workspace: root, tree, expanded: { [root]: true }, tabs: [], activeTabId: null, selectedPath: null, view: 'explorer', sidebarVisible: true })
      get().log('info', `Opened workspace ${root}`)
      void api.memory.indexStatus().then((s) => set({ indexStatus: s }))
    } catch (e) {
      get().toast('error', errorMessage(e))
      throw e
    }
  },
  async closeWorkspace() {
    for (const t of get().tabs) if (t.kind === 'file' && t.content !== t.saved) {
      const ok = await get().confirm('Close folder', `${t.name} has unsaved changes. Close anyway?`, 'Close', true)
      if (!ok) return
      break
    }
    await api.fs.closeWorkspace()
    for (const t of get().tabs) if (t.kind === 'file') disposeModel(t.path)
    set({ workspace: null, tree: null, tabs: [], activeTabId: null, indexStatus: null })
  },
  async refreshTree() {
    try {
      const tree = await api.fs.tree()
      set({ tree })
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  toggleExpanded(path, value) {
    set((s) => ({ expanded: { ...s.expanded, [path]: value ?? !s.expanded[path] } }))
  },

  // ---------- tabs & editor ----------
  async openFile(path, line) {
    const existing = get().tabs.find((t) => t.kind === 'file' && samePath(t.path, path)) as FileTab | undefined
    if (existing) {
      set((s) => ({ activeTabId: existing.id, selectedPath: path, tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, revealLine: line } : t)) }))
      return
    }
    try {
      const content = await api.fs.read(path)
      const tab: FileTab = { id: path, kind: 'file', path, name: basename(path), language: languageFor(path), content, saved: content, revealLine: line }
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, selectedPath: path }))
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  openSettings() {
    if (!get().tabs.some((t) => t.id === 'settings')) set((s) => ({ tabs: [...s.tabs, { id: 'settings', kind: 'settings', name: 'Settings' }] }))
    set({ activeTabId: 'settings' })
  },
  openDiff(cs, itemId) {
    const item = cs.items.find((i) => i.id === itemId)
    if (!item || !('content' in item.action)) return
    const path = joinWs(cs.workspace, item.action.path)
    const id = `diff:${itemId}`
    const tab: DiffTab = {
      id,
      kind: 'diff',
      name: `${basename(path)} (AI changes)`,
      path,
      changeSetId: cs.id,
      itemId,
      original: item.original ?? '',
      proposed: item.action.content,
      language: languageFor(path)
    }
    set((s) => ({ tabs: s.tabs.some((t) => t.id === id) ? s.tabs.map((t) => (t.id === id ? tab : t)) : [...s.tabs, tab], activeTabId: id }))
  },
  async closeTab(id, force) {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.kind === 'file' && tab.content !== tab.saved && !force) {
      const ok = await get().confirm('Unsaved changes', `Do you want to close ${tab.name} without saving? Your changes will be lost.`, "Don't save", true)
      if (!ok) return
    }
    if (tab.kind === 'file') disposeModel(tab.path)
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTabId = s.activeTabId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTabId
      return { tabs, activeTabId }
    })
  },
  setActiveTab(id) {
    set({ activeTabId: id })
  },
  updateContent(path, content) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.kind === 'file' && t.path === path ? { ...t, content } : t)) }))
  },
  async saveFile(path) {
    const tab = (path ? get().tabs.find((t) => t.kind === 'file' && t.path === path) : get().activeFile()) as FileTab | undefined
    if (!tab || tab.kind !== 'file') return false
    try {
      await api.fs.write(tab.path, tab.content)
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tab.id && t.kind === 'file' ? { ...t, saved: tab.content } : t)) }))
      return true
    } catch (e) {
      get().toast('error', `Could not save ${tab.name}: ${errorMessage(e)}`)
      return false
    }
  },
  async saveAs() {
    const tab = get().activeFile()
    if (!tab) return
    try {
      const p = await api.fs.saveAs(tab.path, tab.content)
      if (p) {
        await get().refreshTree()
        await get().openFile(p)
      }
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  async reloadOpenFiles(paths) {
    for (const t of get().tabs) {
      if (t.kind !== 'file') continue
      if (paths && paths.length && !paths.some((p) => samePath(p, t.path))) continue
      let disk: string
      try {
        disk = await api.fs.read(t.path)
      } catch {
        continue // deleted or unreadable: keep the buffer
      }
      if (disk === t.saved) continue
      if (t.content !== t.saved) {
        get().log('warn', `${t.name} changed on disk while it has unsaved edits; keeping your version.`)
        continue
      }
      replaceModelText(t.path, disk)
      set((s) => ({ tabs: s.tabs.map((x) => (x.id === t.id && x.kind === 'file' ? { ...x, content: disk, saved: disk } : x)) }))
    }
  },
  activeFile() {
    const s = get()
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.kind === 'file' ? t : null
  },

  // ---------- panels & execution ----------
  setView(v) {
    set((s) => (s.view === v && s.sidebarVisible ? { sidebarVisible: false } : { view: v, sidebarVisible: true }))
  },
  togglePanel(tab) {
    set((s) => (tab && (!s.panelVisible || s.panelTab !== tab) ? { panelVisible: true, panelTab: tab } : { panelVisible: !s.panelVisible }))
  },
  async runActiveFile() {
    const tab = get().activeFile()
    if (!tab) {
      get().toast('info', 'Open a source file to run it.')
      return
    }
    await get().runPath(tab.path)
  },
  async runPath(path) {
    if (get().runId) await get().stopRun()
    const tab = get().tabs.find((t) => t.kind === 'file' && samePath(t.path, path)) as FileTab | undefined
    if (tab && tab.content !== tab.saved) {
      if (!(await get().saveFile(tab.path))) return
    }
    set({ output: [], problems: [], panelVisible: true, panelTab: 'output', runFile: path })
    try {
      const runId = await api.run.file(path)
      set({ runId })
    } catch (e) {
      set({ runId: null })
      get().toast('error', errorMessage(e))
    }
  },
  async stopRun() {
    const id = get().runId
    if (id) await api.run.stop(id)
  },
  sendStdin(text) {
    const id = get().runId
    if (!id) return
    void api.run.stdin(id, text)
    set((s) => ({ output: [...s.output, { stream: 'system', text }] }))
  },
  appendTerminal(data) {
    set((s) => ({ terminalTail: (s.terminalTail + data).slice(-12000) }))
  },

  // ---------- chat ----------
  async loadConversations() {
    const conversations = await api.chat.list()
    set({ conversations })
    if (!get().conversationId) {
      if (conversations[0]) await get().selectConversation(conversations[0].id)
      else await get().newConversation()
    }
  },
  async selectConversation(id) {
    const messages = await api.chat.messages(id)
    set({ conversationId: id, messages, stream: null })
    for (const m of messages) if (m.meta?.changeSetId) void get().loadChangeSet(m.meta.changeSetId)
  },
  async newConversation() {
    const c = await api.chat.create()
    set((s) => ({ conversations: [c, ...s.conversations], conversationId: c.id, messages: [], stream: null }))
  },
  async deleteConversation(id) {
    await api.chat.remove(id)
    const conversations = get().conversations.filter((c) => c.id !== id)
    set({ conversations })
    if (get().conversationId === id) {
      set({ conversationId: null })
      if (conversations[0]) await get().selectConversation(conversations[0].id)
      else await get().newConversation()
    }
  },
  async clearConversation() {
    const id = get().conversationId
    if (!id) return
    if (!(await get().confirm('Clear conversation', 'Delete every message in this conversation? This cannot be undone.', 'Clear', true))) return
    await api.chat.clear(id)
    set({ messages: [], stream: null })
    void get().loadConversations()
  },
  async sendMessage(text, kind = 'chat') {
    const s = get()
    const trimmed = text.trim()
    if ((!trimmed && !s.pendingAttachments.length) || s.stream) return
    let convId = s.conversationId
    if (!convId) {
      await get().newConversation()
      convId = get().conversationId!
    }
    const attachments = s.pendingAttachments
    set({ pendingAttachments: [], stream: { messageId: 'pending', content: '', thinking: '', status: 'Starting…' } })
    try {
      await api.chat.send({
        conversationId: convId,
        text: trimmed || 'Please look at the attached file(s).',
        attachmentIds: attachments.map((a) => a.id),
        context: buildContext(get()),
        kind
      })
    } catch (e) {
      set({ stream: null, pendingAttachments: attachments })
      get().toast('error', errorMessage(e))
    }
  },
  async regenerate() {
    const s = get()
    if (!s.conversationId || s.stream) return
    const lastUser = [...s.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    const idx = s.messages.lastIndexOf(lastUser)
    set({ messages: s.messages.slice(0, idx + 1), stream: { messageId: 'pending', content: '', thinking: '', status: 'Regenerating…' } })
    try {
      await api.chat.send({ conversationId: s.conversationId, text: lastUser.content, attachmentIds: [], context: buildContext(get()), regenerate: true })
    } catch (e) {
      set({ stream: null })
      get().toast('error', errorMessage(e))
    }
  },
  async stopGeneration() {
    const id = get().conversationId
    if (id) await api.chat.stop(id)
  },
  async fixWithAI() {
    const s = get()
    const r = s.lastRun
    if (!r || r.status === 'success') return
    const attempts = (s.fixAttempts[r.file] ?? 0) + 1
    if (attempts > 3) {
      const ok = await get().confirm(
        'Several fix attempts already',
        `The assistant has proposed ${attempts - 1} fixes for ${basename(r.file)} that did not make it run. Ask again anyway?`,
        'Ask again'
      )
      if (!ok) return
    }
    set((st) => ({ fixAttempts: { ...st.fixAttempts, [r.file]: attempts } }))
    if (!get().settings?.aiSidebarVisible) void get().updateSettings({ aiSidebarVisible: true })
    if (!s.tabs.some((t) => t.kind === 'file' && samePath(t.path, r.file))) await get().openFile(r.file)
    else {
      const tab = get().tabs.find((t) => t.kind === 'file' && samePath(t.path, r.file))!
      set({ activeTabId: tab.id })
    }
    const rel = relativePath(s.workspace, r.file)
    const what = r.status === 'compile-error' ? 'failed to compile' : r.status === 'missing-runtime' ? 'could not run' : `failed with exit code ${r.exitCode}`
    await get().sendMessage(`Running \`${rel}\` ${what}. Find the cause, explain it briefly, and propose the corrected complete file.`, 'fix-request')
  },
  async addAttachments(paths) {
    if (!paths.length) return
    set({ attaching: true })
    try {
      const atts = await api.attachments.addPaths(paths)
      set((s) => ({ pendingAttachments: [...s.pendingAttachments, ...atts] }))
      await afterAttach(atts, get)
    } catch (e) {
      get().toast('error', errorMessage(e))
    } finally {
      set({ attaching: false })
    }
  },
  async pickAttachments() {
    set({ attaching: true })
    try {
      const atts = await api.attachments.pick()
      set((s) => ({ pendingAttachments: [...s.pendingAttachments, ...atts] }))
      await afterAttach(atts, get)
    } catch (e) {
      get().toast('error', errorMessage(e))
    } finally {
      set({ attaching: false })
    }
  },
  async addImageData(name, dataUrl) {
    try {
      const att = await api.attachments.addImageData(name, dataUrl)
      set((s) => ({ pendingAttachments: [...s.pendingAttachments, att] }))
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  removeAttachment(id) {
    set((s) => ({ pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id) }))
    void api.attachments.remove(id)
  },
  focusChat(draft) {
    set((s) => ({ chatInputFocusTick: s.chatInputFocusTick + 1, chatDraft: draft ?? s.chatDraft }))
    if (!get().settings?.aiSidebarVisible) void get().updateSettings({ aiSidebarVisible: true })
  },

  // ---------- change sets ----------
  async loadChangeSet(id) {
    const cs = await api.changes.get(id)
    if (cs) set((s) => ({ changeSets: { ...s.changeSets, [id]: cs } }))
    return cs
  },
  async applyChanges(id, itemIds) {
    try {
      const cs = await api.changes.apply(id, itemIds)
      set((s) => ({ changeSets: { ...s.changeSets, [id]: cs } }))
      const applied = cs.items.filter((i) => (!itemIds || itemIds.includes(i.id)) && i.status === 'applied')
      const failed = cs.items.filter((i) => (!itemIds || itemIds.includes(i.id)) && i.status === 'failed')
      const paths = applied.flatMap((i) => ('path' in i.action ? [joinWs(cs.workspace, i.action.path)] : 'to' in i.action ? [joinWs(cs.workspace, i.action.to)] : []))
      await get().refreshTree()
      await get().reloadOpenFiles(paths)
      // Close diff tabs for items that are no longer pending.
      set((s) => ({ tabs: s.tabs.filter((t) => !(t.kind === 'diff' && t.changeSetId === id && cs.items.find((i) => i.id === t.itemId)?.status !== 'pending')) }))
      if (failed.length) get().toast('error', `${failed.length} change(s) failed: ${failed.map((f) => f.error).join('; ')}`)
      else if (applied.length) get().toast('success', `Applied ${applied.length} change(s)`)
      // Open the first created/edited file so the result is visible.
      const firstFile = applied.find((i) => i.action.type === 'create_file' || i.action.type === 'edit_file')
      if (firstFile && 'path' in firstFile.action) {
        const p = joinWs(cs.workspace, firstFile.action.path)
        await get().openFile(p)
      }
      return cs
    } catch (e) {
      get().toast('error', errorMessage(e))
      return null
    }
  },
  async rejectChanges(id, itemIds) {
    try {
      const cs = await api.changes.reject(id, itemIds)
      set((s) => ({
        changeSets: { ...s.changeSets, [id]: cs },
        tabs: s.tabs.filter((t) => !(t.kind === 'diff' && t.changeSetId === id && cs.items.find((i) => i.id === t.itemId)?.status !== 'pending'))
      }))
      if (get().activeTabId && !get().tabs.some((t) => t.id === get().activeTabId)) set({ activeTabId: get().tabs.at(-1)?.id ?? null })
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  async undoChanges(id) {
    try {
      const cs = await api.changes.undo(id)
      set((s) => ({ changeSets: { ...s.changeSets, [id]: cs } }))
      const paths = cs.items.flatMap((i) => ('path' in i.action ? [joinWs(cs.workspace, i.action.path)] : []))
      await get().refreshTree()
      await get().reloadOpenFiles(paths)
      get().toast('info', 'Changes undone')
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  async applyAndRun(id, file) {
    const cs = await get().applyChanges(id)
    if (!cs || cs.items.some((i) => i.status === 'failed')) return
    const attempt = get().fixAttempts[file] ?? 1
    set((s) => ({ verifications: { ...s.verifications, [id]: { status: 'running', attempt } } }))
    await get().runPath(file)
    const runId = get().runId
    if (runId) set((s) => ({ runToChangeSet: { ...s.runToChangeSet, [runId]: id } }))
  },
  async loadKnowledge() {
    try {
      set({ knowledgeDocs: await api.knowledge.list() })
    } catch (e) {
      get().log('warn', `Knowledge library: ${errorMessage(e)}`)
    }
  },
  async addKnowledge(paths) {
    try {
      const r = await api.knowledge.add(paths)
      await get().loadKnowledge()
      if (r.added.length) get().toast('success', `Added ${r.added.map((d) => d.name).join(', ')} to the knowledge library`)
      for (const err of r.errors) get().toast('error', err)
    } catch (e) {
      get().toast('error', errorMessage(e))
    }
  },
  async proposeEdit(path, content) {
    const convId = get().conversationId
    if (!convId) return
    try {
      const cs = await api.changes.proposeEdit(convId, path, content)
      set((s) => ({ changeSets: { ...s.changeSets, [cs.id]: cs } }))
      get().openDiff(cs, cs.items[0].id)
    } catch (e) {
      get().toast('info', errorMessage(e))
    }
  }
}))

function joinWs(ws: string, rel: string): string {
  const sep = ws.includes('\\') ? '\\' : '/'
  return ws.replace(/[\\/]+$/, '') + sep + rel.split('/').join(sep)
}
export { joinWs }

async function afterAttach(atts: Attachment[], get: () => State & Actions): Promise<void> {
  for (const a of atts) {
    if (a.kind === 'zip' && a.extractedTo) {
      if (!get().workspace) {
        const ok = await get().confirm('Open extracted project?', `${a.name} was extracted safely (${a.fileCount} files). Open it as the workspace so the assistant can index it?`, 'Open')
        if (ok) await get().openWorkspace(a.extractedTo)
      } else {
        await get().refreshTree()
        get().toast('success', `${a.name} extracted to ${relativePath(get().workspace, a.extractedTo)} (${a.fileCount} files)`)
      }
    }
    if (a.note) get().toast('info', `${a.name}: ${a.note}`)
  }
}

let subscribed = false
function subscribeEvents(set: (p: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State & Actions): void {
  if (subscribed) return
  subscribed = true

  api.chat.onEvent((e: ChatEvent) => {
    const s = get()
    if (e.conversationId !== s.conversationId) {
      if (e.type === 'done') void get().loadConversations()
      return
    }
    switch (e.type) {
      case 'start':
        set((st) => ({
          stream: { messageId: e.messageId, content: '', thinking: '', status: 'Starting…' },
          messages: e.userMessage ? [...st.messages, e.userMessage] : st.messages
        }))
        break
      case 'status':
        set((st) => (st.stream ? { stream: { ...st.stream, status: e.text } } : {}))
        get().log('info', e.text)
        break
      case 'token':
        set((st) => (st.stream ? { stream: { ...st.stream, content: st.stream.content + e.text, status: '' } } : {}))
        break
      case 'thinking':
        set((st) => (st.stream ? { stream: { ...st.stream, thinking: st.stream.thinking + e.text, status: 'Reasoning…' } } : {}))
        break
      case 'reset':
        set((st) => (st.stream ? { stream: { ...st.stream, content: '' } } : {}))
        break
      case 'done':
        set((st) => ({
          stream: null,
          messages: [...st.messages, e.message],
          changeSets: e.changeSet ? { ...st.changeSets, [e.changeSet.id]: e.changeSet } : st.changeSets
        }))
        if (e.message.meta?.error) get().log('error', e.message.meta.error)
        if (e.changeSet) {
          const cs = e.changeSet
          const firstEdit = cs.items.find((i) => i.status === 'pending' && i.action.type === 'edit_file')
          // Hidden assistant: never open tabs on its own; the change card waits in the chat.
          if (firstEdit && get().settings?.aiSidebarVisible) get().openDiff(cs, firstEdit.id)
          if (cs.items.some((i) => i.status === 'applied')) {
            void get().refreshTree()
            void get().reloadOpenFiles()
          }
        }
        void api.chat.list().then((conversations) => set({ conversations }))
        break
      case 'error':
        set({ stream: null })
        if (get().settings?.aiSidebarVisible) get().toast('error', e.error)
        else get().log('error', e.error)
        break
    }
  })

  api.run.onEvent((e: RunEvent) => {
    if (e.type === 'start') {
      set((s) => ({ runCommand: e.command, output: s.runId === e.runId || !s.runId ? s.output : s.output }))
      get().log('info', `Run: ${e.command}`)
    } else if (e.type === 'data') {
      set((s) => ({ output: [...s.output.slice(-4000), { stream: e.stream, text: e.text }] }))
    } else {
      const r = e.result
      const isFileRun = r.language !== 'shell'
      set((s) => ({
        runId: s.runId === e.runId ? null : s.runId,
        ...(isFileRun ? { lastRun: r, problems: r.problems } : {}),
        output: [
          ...s.output,
          {
            stream: 'system',
            text: `\n${r.status === 'success' ? '✓' : '✗'} ${r.status === 'killed' ? 'Stopped' : r.status === 'missing-runtime' ? 'Runtime missing' : `Exited with code ${r.exitCode ?? 'none'}`} · ${(r.durationMs / 1000).toFixed(2)}s\n`
          }
        ]
      }))
      if (isFileRun && r.status === 'success') set((s) => ({ fixAttempts: { ...s.fixAttempts, [r.file]: 0 } }))
      const csId = get().runToChangeSet[e.runId]
      if (csId) {
        const v = get().verifications[csId]
        set((s) => ({ verifications: { ...s.verifications, [csId]: { status: r.status === 'success' ? 'passed' : 'failed', exitCode: r.exitCode, attempt: v?.attempt ?? 1 } } }))
      }
      get().log(r.status === 'success' ? 'info' : 'warn', `${basename(r.file)}: ${r.status} (exit ${r.exitCode ?? 'none'}, ${r.durationMs} ms)`)
    }
  })

  api.fs.onChanged((e) => {
    void get().refreshTree()
    void get().reloadOpenFiles(e.paths)
  })

  api.ollama.onPullProgress((p) => {
    set((s) => ({ pulls: { ...s.pulls, [p.model]: p } }))
    if (p.done) {
      if (p.error) get().toast('error', `Download of ${p.model} failed: ${p.error}`)
      else get().toast('success', `${p.model} downloaded`)
      get().log(p.error ? 'error' : 'info', `Pull ${p.model}: ${p.error ?? 'complete'}`)
      void get().refreshOllama()
      setTimeout(() => set((s) => {
        const pulls = { ...s.pulls }
        delete pulls[p.model]
        return { pulls }
      }), 1500)
    }
  })

  api.memory.onIndexStatus((s) => set({ indexStatus: s }))

  api.knowledge.onProgress((p) => {
    set((s) => ({ knowledgeProgress: { ...s.knowledgeProgress, [p.docId]: p } }))
    if (p.stage === 'ready' || p.stage === 'error') void get().loadKnowledge()
    if (p.stage === 'error' && p.error) get().log('warn', `Knowledge: ${p.name}: ${p.error}`)
  })
}

export function useActiveTab(): Tab | null {
  return useApp((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
}

export function isDirty(t: Tab): boolean {
  return t.kind === 'file' && t.content !== t.saved
}

export function hasModel(path: string): boolean {
  return !!getModel(path)
}
