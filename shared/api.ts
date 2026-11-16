import type {
  AppInfo,
  Attachment,
  ChangeSet,
  ChatEvent,
  ChatMessage,
  ChatRequest,
  Conversation,
  FileNode,
  FsChangeEvent,
  HardwareInfo,
  IndexStatus,
  KnowledgeDoc,
  KnowledgeHit,
  KnowledgeProgress,
  OllamaStatus,
  ProjectMemory,
  PullProgress,
  RunEvent,
  RuntimeInfo,
  SearchHit,
  SetupProgress,
  SetupStatus,
  Settings,
  ThemeName
} from './types'

export type Unsubscribe = () => void

/** The complete surface the preload script exposes on window.api. */
export interface LocalCodeApi {
  app: {
    info(): Promise<AppInfo>
    setTheme(theme: ThemeName): Promise<void>
    openExternal(url: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  hardware: {
    detect(): Promise<HardwareInfo>
  }
  fs: {
    pickFolder(): Promise<string | null>
    openWorkspace(path: string): Promise<{ root: string; tree: FileNode }>
    closeWorkspace(): Promise<void>
    tree(): Promise<FileNode | null>
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    saveAs(defaultPath: string, content: string): Promise<string | null>
    createFile(path: string): Promise<void>
    createDir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    move(from: string, toDir: string): Promise<string>
    remove(path: string): Promise<void>
    search(query: string, opts: { regex?: boolean; caseSensitive?: boolean }): Promise<SearchHit[]>
    reveal(path: string): Promise<void>
    importZip(zipPath?: string): Promise<{ root: string; files: number } | null>
    exportZip(dir?: string): Promise<string | null>
    pathForFile(file: File): string
    onChanged(cb: (e: FsChangeEvent) => void): Unsubscribe
  }
  ollama: {
    status(): Promise<OllamaStatus>
    start(): Promise<boolean>
    pull(model: string): Promise<void>
    cancelPull(model: string): Promise<void>
    unload(model: string): Promise<void>
    remove(model: string): Promise<void>
    onPullProgress(cb: (p: PullProgress) => void): Unsubscribe
  }
  chat: {
    list(): Promise<Conversation[]>
    create(): Promise<Conversation>
    messages(conversationId: string): Promise<ChatMessage[]>
    rename(conversationId: string, title: string): Promise<void>
    remove(conversationId: string): Promise<void>
    clear(conversationId: string): Promise<void>
    send(req: ChatRequest): Promise<void>
    stop(conversationId: string): Promise<void>
    onEvent(cb: (e: ChatEvent) => void): Unsubscribe
  }
  attachments: {
    pick(): Promise<Attachment[]>
    addPaths(paths: string[]): Promise<Attachment[]>
    addImageData(name: string, dataUrl: string): Promise<Attachment>
    remove(id: string): Promise<void>
  }
  changes: {
    get(id: string): Promise<ChangeSet | null>
    apply(id: string, itemIds?: string[]): Promise<ChangeSet>
    reject(id: string, itemIds?: string[]): Promise<ChangeSet>
    undo(id: string): Promise<ChangeSet>
    proposeEdit(conversationId: string, path: string, content: string): Promise<ChangeSet>
  }
  run: {
    file(path: string): Promise<string>
    stop(runId: string): Promise<void>
    stdin(runId: string, text: string): Promise<void>
    runtimes(): Promise<RuntimeInfo[]>
    onEvent(cb: (e: RunEvent) => void): Unsubscribe
  }
  terminal: {
    create(cols: number, rows: number): Promise<{ id: string; shell: string } | { error: string }>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): Unsubscribe
    onExit(cb: (id: string, code: number) => void): Unsubscribe
  }
  setup: {
    status(): Promise<SetupStatus>
    installOllama(): Promise<{ ok: boolean; message: string }>
    pullModels(models: string[]): Promise<{ ok: boolean; failed: string[] }>
    cancel(): Promise<void>
    onProgress(cb: (p: SetupProgress) => void): Unsubscribe
  }
  knowledge: {
    list(): Promise<KnowledgeDoc[]>
    add(paths?: string[]): Promise<{ added: KnowledgeDoc[]; errors: string[] }>
    remove(id: string): Promise<void>
    setEnabled(id: string, enabled: boolean): Promise<void>
    reembed(): Promise<KnowledgeDoc[]>
    search(query: string): Promise<{ hits: KnowledgeHit[]; semantic: boolean }>
    onProgress(cb: (p: KnowledgeProgress) => void): Unsubscribe
  }
  memory: {
    get(): Promise<ProjectMemory | null>
    setNotes(notes: string): Promise<void>
    clear(): Promise<void>
    reindex(): Promise<IndexStatus>
    indexStatus(): Promise<IndexStatus>
    onIndexStatus(cb: (s: IndexStatus) => void): Unsubscribe
  }
}
