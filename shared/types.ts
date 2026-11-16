// Types shared between the Electron main process and the React renderer.

export type ThemeName = 'dark' | 'light'
export type HardwareProfile = 'lite' | 'balanced' | 'deep'

export interface FileNode {
  name: string
  path: string // absolute
  type: 'file' | 'directory'
  children?: FileNode[]
  truncated?: boolean
}

export interface ModelRoles {
  general: string
  coder: string
  reasoning: string
  vision: string
  embedding: string
}

export interface Settings {
  theme: ThemeName
  ollamaUrl: string
  profile: HardwareProfile
  roles: ModelRoles
  numCtx: number
  temperature: number
  topP: number
  keepAlive: string
  autoRouting: boolean
  singleModelResidency: boolean
  autoApplyEdits: boolean
  maxAgentSteps: number
  editorFontSize: number
  terminalFontSize: number
  terminalShell: string
  defaultWorkspace: string | null
  lastWorkspace: string | null
  aiSidebarVisible: boolean
  aiSidebarWidth: number
  knowledgeEnabled: boolean
  presetVersion: number
  setupDone: boolean
  autoUpdate: boolean
  reasoningBudget: number
}

export interface GpuInfo {
  name: string
  vramGB: number | null
  source: string
}

export interface HardwareInfo {
  platform: string
  arch: string
  cpuModel: string
  cpuCores: number
  totalRamGB: number
  freeRamGB: number
  gpus: GpuInfo[]
  recommendedProfile: HardwareProfile
  notes: string[]
}

export interface OllamaModel {
  name: string
  size: number
  modifiedAt: string
  family?: string
  parameterSize?: string
  quantization?: string
  capabilities?: string[]
}

export interface OllamaRunning {
  name: string
  size: number
  sizeVram: number
  expiresAt: string
}

export interface OllamaStatus {
  connected: boolean
  url: string
  version?: string
  error?: string
  installedPath: string | null
  models: OllamaModel[]
  running: OllamaRunning[]
}

export interface PullProgress {
  model: string
  status: string
  completed?: number
  total?: number
  done?: boolean
  error?: string
}

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'zip'

export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  size: number
  mime?: string
  preview?: string // small data URL for images
  pages?: number
  chars?: number
  extractedTo?: string
  fileCount?: number
  note?: string
}

export interface MessageMeta {
  route?: string
  models?: string[]
  changeSetId?: string
  error?: string
  durationMs?: number
  steps?: string[]
  thinking?: string
  kind?: 'fix-request' | 'chat'
  stopped?: boolean
  visionNotes?: string
  fixFile?: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  attachments?: Attachment[]
  model?: string
  meta?: MessageMeta
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  workspace: string | null
}

// ---------- Structured file actions ----------

export type FileAction =
  | { type: 'create_file'; path: string; content: string }
  | { type: 'edit_file'; path: string; content: string }
  | { type: 'delete_file'; path: string }
  | { type: 'rename_file'; from: string; to: string }
  | { type: 'create_directory'; path: string }
  | { type: 'run_command'; command: string; cwd?: string }
  | { type: 'read_file'; path: string }
  | { type: 'search_files'; query: string }

export type ChangeItemStatus = 'pending' | 'applied' | 'rejected' | 'failed'

export interface ChangeItem {
  id: string
  action: FileAction
  status: ChangeItemStatus
  original: string | null // previous file content, null if file did not exist
  destructive: boolean
  added?: number
  removed?: number
  error?: string
  output?: string
}

export interface ChangeSet {
  id: string
  conversationId: string
  messageId: string
  workspace: string
  createdAt: number
  items: ChangeItem[]
}

// ---------- Chat requests & events ----------

export interface RunProblem {
  file: string
  line: number
  column?: number
  message: string
  severity: 'error' | 'warning'
}

export interface RunResult {
  runId: string
  file: string
  language: string
  command: string
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  status: 'success' | 'error' | 'killed' | 'missing-runtime' | 'compile-error'
  problems: RunProblem[]
}

export interface EditorContext {
  workspace: string | null
  activeFile?: { path: string; content: string; language: string; dirty: boolean }
  selection?: { text: string; startLine: number; endLine: number }
  openFiles: string[]
  terminalOutput?: string
  lastRun?: RunResult
}

export interface ChatRequest {
  conversationId: string
  text: string
  attachmentIds: string[]
  context: EditorContext
  kind?: 'chat' | 'fix-request'
  regenerate?: boolean
}

export type ChatEvent =
  | { type: 'start'; conversationId: string; messageId: string; userMessage?: ChatMessage }
  | { type: 'status'; conversationId: string; messageId: string; text: string }
  | { type: 'token'; conversationId: string; messageId: string; text: string }
  | { type: 'thinking'; conversationId: string; messageId: string; text: string }
  | { type: 'reset'; conversationId: string; messageId: string }
  | { type: 'done'; conversationId: string; messageId: string; message: ChatMessage; changeSet?: ChangeSet }
  | { type: 'error'; conversationId: string; messageId: string; error: string }

// ---------- Execution ----------

export type RunEvent =
  | { type: 'start'; runId: string; command: string; file: string }
  | { type: 'data'; runId: string; stream: 'stdout' | 'stderr' | 'system'; text: string }
  | { type: 'exit'; runId: string; result: RunResult }

export interface RuntimeInfo {
  language: string
  label: string
  available: boolean
  command?: string
  version?: string
  installHint: string
}

// ---------- Search / index / memory ----------

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface IndexStatus {
  workspace: string | null
  files: number
  chunks: number
  indexing: boolean
  lastIndexed: number | null
}

export interface ProjectMemory {
  workspace: string
  summary: string
  notes: string
  updatedAt: number
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  dbPath: string
}

// ---------- Knowledge library (syllabus, notes, references) ----------

export interface KnowledgeDoc {
  id: string
  name: string
  kind: string
  size: number
  pages: number
  chars: number
  chunks: number
  embedded: number
  embedModel: string | null
  enabled: boolean
  error: string | null
  createdAt: number
}

export interface KnowledgeHit {
  docId: string
  docName: string
  page: number // 0 = a whole numbered section
  content: string
  score: number
  chunkId: number
}

export interface KnowledgeProgress {
  docId: string
  name: string
  stage: 'extracting' | 'embedding' | 'ready' | 'error'
  done: number
  total: number
  error?: string
}

// ---------- Updates ----------

export interface UpdateState {
  status: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported'
  currentVersion: string
  latestVersion?: string
  percent?: number
  checkedAt?: number
  error?: string
}

// ---------- First-run setup ----------

export interface SetupStatus {
  platform: string
  ollamaPath: string | null
  ollamaRunning: boolean
  ollamaVersion?: string
  profile: HardwareProfile
  recommendedProfile: HardwareProfile
  hardwareSummary: string
  required: Array<{ name: string; sizeGB: number | null; installed: boolean }>
  presets: Record<HardwareProfile, { label: string; totalGB: number }>
}

export interface SetupProgress {
  step: string // 'ollama' or a model name
  status: string
  completed?: number
  total?: number
  done?: boolean
  error?: string
}

export interface FsChangeEvent {
  paths: string[]
}
