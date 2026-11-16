import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Download, ExternalLink, HardDrive, Power, RefreshCw, Trash2, XCircle, X } from 'lucide-react'
import type { AppInfo, HardwareProfile, ModelRoles, ProjectMemory, RuntimeInfo } from '@shared/types'
import { PROFILE_PRESETS } from '@shared/profiles'
import { useApp } from '@/store/app'
import { api, errorMessage, formatBytes } from '@/lib/api'
import { Badge, Button, IconButton, Select, Spinner, TextInput, Toggle } from '../ui'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="border-b border-line py-5">
      <h2 className="mb-3 text-[15px] font-semibold text-fg-strong">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Field({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-ui font-semibold text-fg">{label}</div>
      {description && <div className="text-ui-sm text-muted">{description}</div>}
      <div className="max-w-[460px]">{children}</div>
    </div>
  )
}

const NAV = [
  ['appearance', 'Appearance'],
  ['ollama', 'Ollama'],
  ['hardware', 'Hardware profile'],
  ['models', 'Models'],
  ['generation', 'Generation'],
  ['editor', 'Editor & terminal'],
  ['runtimes', 'Runtimes'],
  ['memory', 'Project memory'],
  ['conversations', 'Conversations'],
  ['about', 'About']
] as const

const INSTALL_HELP: Record<string, string> = {
  win32: 'Download the Windows installer from https://ollama.com/download, or run: winget install Ollama.Ollama',
  darwin: 'Download Ollama for macOS from https://ollama.com/download, or run: brew install ollama',
  linux: 'Run: curl -fsSL https://ollama.com/install.sh | sh   (see https://ollama.com/download)'
}

export function SettingsView() {
  const settings = useApp((s) => s.settings)
  const ollama = useApp((s) => s.ollama)
  const hardware = useApp((s) => s.hardware)
  const pulls = useApp((s) => s.pulls)
  const platform = useApp((s) => s.platform)
  const workspace = useApp((s) => s.workspace)
  const indexStatus = useApp((s) => s.indexStatus)
  const conversations = useApp((s) => s.conversations)
  const { updateSettings, refreshOllama, detectHardware, toast, confirm, deleteConversation } = useApp.getState()
  const [url, setUrl] = useState(settings?.ollamaUrl ?? '')
  const [customModel, setCustomModel] = useState('')
  const [runtimes, setRuntimes] = useState<RuntimeInfo[] | null>(null)
  const [memory, setMemory] = useState<ProjectMemory | null>(null)
  const [notes, setNotes] = useState('')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void api.run.runtimes().then(setRuntimes)
    void api.app.info().then(setInfo)
  }, [])
  useEffect(() => {
    void api.memory.get().then((m) => {
      setMemory(m)
      setNotes(m?.notes ?? '')
    })
  }, [workspace, indexStatus?.lastIndexed])

  if (!settings) return null
  const installed = ollama?.models ?? []
  const names = installed.map((m) => m.name)
  const preset = PROFILE_PRESETS[settings.profile]

  const pull = async (model: string) => {
    if (!model.trim()) return
    try {
      await api.ollama.pull(model.trim())
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  const applyProfile = (p: HardwareProfile) => {
    const pr = PROFILE_PRESETS[p]
    void updateSettings({ profile: p, numCtx: pr.numCtx, temperature: pr.temperature, roles: pr.roles })
  }

  const roleSelect = (role: keyof ModelRoles, label: string, description: string) => {
    const value = settings.roles[role]
    const missing = value && !names.includes(value) && !names.includes(value + ':latest')
    const selected = names.includes(value) ? value : names.includes(value + ':latest') ? value + ':latest' : value
    const isEmbed = (m: (typeof installed)[number]) => !!m.capabilities?.includes('embedding') || /embed/i.test(m.name)
    const options = installed.filter((m) => (role === 'embedding' ? isEmbed(m) : !isEmbed(m)))
    return (
      <Field label={label} description={description}>
        <div className="flex items-center gap-2">
          <Select className="min-w-[260px]" value={selected} onChange={(e) => void updateSettings({ roles: { ...settings.roles, [role]: e.target.value } })}>
            {missing && <option value={value}>{value} (not installed)</option>}
            {options.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
                {m.capabilities?.includes('vision') ? ' · vision' : ''}
              </option>
            ))}
          </Select>
          {missing && (
            <Button size="sm" icon={Download} busy={!!pulls[value]} onClick={() => void pull(value)}>
              Download
            </Button>
          )}
        </div>
      </Field>
    )
  }

  const suggested = [...new Set([...PROFILE_PRESETS.lite.suggested, ...PROFILE_PRESETS.balanced.suggested, ...PROFILE_PRESETS.deep.suggested])]

  return (
    <div className="flex h-full bg-editor">
      <nav className="w-[180px] shrink-0 overflow-auto border-r border-line py-4" aria-label="Settings sections">
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="block cursor-pointer px-5 py-1 text-ui text-fg hover:bg-hover">
            {label}
          </a>
        ))}
      </nav>
      <div className="selectable min-w-0 flex-1 overflow-auto px-8 pb-16">
        <Section id="appearance" title="Appearance">
          <Field label="Color theme">
            <Select value={settings.theme} onChange={(e) => void updateSettings({ theme: e.target.value as 'dark' | 'light' })}>
              <option value="dark">Dark+ (default dark)</option>
              <option value="light">Light+ (default light)</option>
            </Select>
          </Field>
        </Section>

        <Section id="ollama" title="Ollama">
          <Button size="sm" icon={Download} className="self-start" onClick={() => useApp.setState({ setupOpen: true })}>
            Run setup wizard (install Ollama and models)
          </Button>
          <div className="flex items-center gap-2 text-ui">
            {ollama?.connected ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-error" />}
            {ollama == null ? 'Checking…' : ollama.connected ? `Connected — Ollama ${ollama.version}, ${installed.length} model(s) installed` : `Not connected: ${ollama.error}`}
            <IconButton icon={RefreshCw} label="Check again" onClick={() => void refreshOllama()} />
          </div>
          {ollama && !ollama.connected && (
            <div className="max-w-[640px] rounded-[2px] border border-line-strong bg-sidebar p-3 text-ui-sm">
              {ollama.installedPath ? (
                <>
                  <p className="mb-2">Ollama is installed ({ollama.installedPath}) but its server is not responding.</p>
                  <Button
                    size="sm"
                    icon={Power}
                    busy={starting}
                    onClick={async () => {
                      setStarting(true)
                      await api.ollama.start()
                      setTimeout(() => {
                        void refreshOllama()
                        setStarting(false)
                      }, 3000)
                    }}
                  >
                    Start Ollama
                  </Button>
                </>
              ) : (
                <>
                  <p className="mb-1 font-semibold">Ollama is not installed.</p>
                  <p className="mb-2">LocalCode AI Studio uses Ollama to run AI models on this computer. Install it once (needs internet), download a model, and everything works offline afterwards.</p>
                  <p className="mb-2 font-mono">{INSTALL_HELP[platform] ?? INSTALL_HELP.linux}</p>
                  <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => void api.app.openExternal('https://ollama.com/download')}>
                    Open ollama.com/download
                  </Button>
                </>
              )}
            </div>
          )}
          <Field label="Server URL" description="Where the Ollama REST API listens. The default is http://localhost:11434.">
            <div className="flex gap-2">
              <TextInput value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button variant="secondary" onClick={() => void updateSettings({ ollamaUrl: url.trim() })} disabled={url.trim() === settings.ollamaUrl}>
                Save
              </Button>
            </div>
          </Field>
        </Section>

        <Section id="hardware" title="Hardware profile">
          {hardware ? (
            <div className="grid max-w-[640px] grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-ui-sm">
              <span className="text-muted">System</span>
              <span>
                {hardware.platform} ({hardware.arch})
              </span>
              <span className="text-muted">CPU</span>
              <span>
                {hardware.cpuModel} · {hardware.cpuCores} threads
              </span>
              <span className="text-muted">Memory</span>
              <span>
                {hardware.totalRamGB} GB total · {hardware.freeRamGB} GB free
              </span>
              <span className="text-muted">GPU</span>
              <span>
                {hardware.gpus.length
                  ? hardware.gpus.map((g) => `${g.name}${g.vramGB != null ? ` · ${g.vramGB} GB` : ''} (${g.source})`).join('; ')
                  : 'None detected'}
              </span>
              <span className="text-muted">Recommended</span>
              <span>{PROFILE_PRESETS[hardware.recommendedProfile].label} mode</span>
            </div>
          ) : (
            <Spinner />
          )}
          {hardware?.notes.map((n, i) => (
            <p key={i} className="max-w-[640px] text-ui-sm text-muted">
              {n}
            </p>
          ))}
          <div className="flex gap-2">
            {(Object.keys(PROFILE_PRESETS) as HardwareProfile[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyProfile(p)}
                className={`w-[210px] cursor-pointer rounded-[4px] border p-2.5 text-left ${settings.profile === p ? 'border-focus bg-selected-focus/40' : 'border-line-strong hover:bg-hover'}`}
              >
                <div className="flex items-center gap-1.5 text-ui font-semibold text-fg-strong">
                  {PROFILE_PRESETS[p].label}
                  {hardware?.recommendedProfile === p && <Badge tone="info">recommended</Badge>}
                </div>
                <div className="mt-1 text-ui-sm text-muted">{PROFILE_PRESETS[p].description}</div>
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} className="self-start" onClick={() => void detectHardware()}>
            Detect hardware again
          </Button>
        </Section>

        <Section id="models" title="Models">
          <p className="max-w-[640px] text-ui-sm text-muted">
            The assistant picks a model for each request automatically. Choose which installed model fills each role. Selecting a profile above sets suggested roles for {preset.label} mode.
          </p>
          {roleSelect('general', 'Conversation model', 'Everyday questions, explanations, documents.')}
          {roleSelect('coder', 'Coding model', 'Code generation, debugging, repository questions.')}
          {roleSelect('reasoning', 'Reasoning model', 'Algorithms, data structures and step-by-step problems.')}
          {roleSelect('vision', 'Vision model', 'Screenshots and images. Must be a vision-capable model such as qwen2.5vl.')}
          {roleSelect('embedding', 'Embedding model', 'Turns your knowledge library (syllabus, notes) into vectors for semantic search, e.g. nomic-embed-text. Changing it requires re-embedding the library.')}

          <div className="mt-2 text-ui font-semibold text-fg">Download models</div>
          <p className="max-w-[640px] text-ui-sm text-muted">Downloads need internet once; models are then stored locally by Ollama. Sizes are several GB.</p>
          <div className="flex max-w-[640px] flex-col gap-1">
            {suggested.map((m) => {
              const has = names.includes(m)
              const p = pulls[m]
              return (
                <div key={m} className="flex items-center gap-2 text-ui">
                  <span className="w-[200px] font-mono text-ui-sm">{m}</span>
                  {has ? (
                    <Badge tone="success">installed</Badge>
                  ) : p ? (
                    <PullBar model={m} />
                  ) : (
                    <Button size="sm" variant="secondary" icon={Download} disabled={!ollama?.connected} onClick={() => void pull(m)}>
                      Download
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex max-w-[460px] gap-2">
            <TextInput placeholder="Any Ollama model, e.g. qwen2.5-coder:1.5b" value={customModel} onChange={(e) => setCustomModel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void pull(customModel)} />
            <Button icon={Download} disabled={!ollama?.connected || !customModel.trim()} onClick={() => void pull(customModel)}>
              Pull
            </Button>
          </div>
          {Object.keys(pulls)
            .filter((m) => !suggested.includes(m))
            .map((m) => (
              <div key={m} className="flex items-center gap-2">
                <span className="w-[200px] font-mono text-ui-sm">{m}</span>
                <PullBar model={m} />
              </div>
            ))}

          <div className="mt-2 text-ui font-semibold text-fg">Installed</div>
          {installed.length === 0 && <div className="text-ui-sm text-muted">No models installed.</div>}
          <div className="flex max-w-[760px] flex-col">
            {installed.map((m) => {
              const loaded = ollama?.running.find((r) => r.name === m.name)
              return (
                <div key={m.name} className="flex items-center gap-2 border-b border-line py-1.5 text-ui-sm">
                  <HardDrive size={14} className="text-muted" />
                  <span className="w-[220px] truncate font-mono">{m.name}</span>
                  <span className="w-[70px] text-muted">{formatBytes(m.size)}</span>
                  <span className="w-[110px] truncate text-muted">
                    {m.parameterSize} {m.quantization}
                  </span>
                  <span className="flex flex-1 flex-wrap gap-1">
                    {m.capabilities?.filter((c) => c !== 'completion').map((c) => (
                      <Badge key={c}>{c}</Badge>
                    ))}
                    {loaded && <Badge tone="success">loaded · {formatBytes(loaded.sizeVram)} VRAM</Badge>}
                  </span>
                  {loaded && (
                    <Button size="sm" variant="secondary" onClick={() => void api.ollama.unload(m.name).then(refreshOllama)}>
                      Unload
                    </Button>
                  )}
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${m.name}`}
                    onClick={async () => {
                      if (await confirm('Delete model', `Delete ${m.name} from Ollama (${formatBytes(m.size)})? You can download it again later.`, 'Delete', true)) {
                        try {
                          await api.ollama.remove(m.name)
                          void refreshOllama()
                        } catch (e) {
                          toast('error', errorMessage(e))
                        }
                      }
                    }}
                  />
                </div>
              )
            })}
          </div>
        </Section>

        <Section id="generation" title="Generation">
          <Field label="Context size (num_ctx)" description="Tokens the model can see at once. Larger uses much more memory and is slower.">
            <Select value={settings.numCtx} onChange={(e) => void updateSettings({ numCtx: Number(e.target.value) })}>
              {[2048, 4096, 8192, 12288, 16384, 32768].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} tokens
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Temperature: ${settings.temperature.toFixed(2)}`} description="Lower is more focused and deterministic; coding requests are capped at 0.3.">
            <input type="range" min={0} max={1.2} step={0.05} value={settings.temperature} onChange={(e) => void updateSettings({ temperature: Number(e.target.value) })} className="w-[260px] accent-[var(--vs-accent)]" />
          </Field>
          <Field label={`Top P: ${settings.topP.toFixed(2)}`}>
            <input type="range" min={0.1} max={1} step={0.05} value={settings.topP} onChange={(e) => void updateSettings({ topP: Number(e.target.value) })} className="w-[260px] accent-[var(--vs-accent)]" />
          </Field>
          <Field label="Keep model loaded for" description='How long Ollama keeps a model in memory after a request (keep_alive), e.g. "10m", "30m", "0".'>
            <TextInput className="w-[120px]" defaultValue={settings.keepAlive} onBlur={(e) => e.target.value.trim() && void updateSettings({ keepAlive: e.target.value.trim() })} />
          </Field>
          <Field label="Agent steps" description="How many times the assistant may read files and continue before answering.">
            <Select value={settings.maxAgentSteps} onChange={(e) => void updateSettings({ maxAgentSteps: Number(e.target.value) })}>
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle checked={settings.autoRouting} onChange={(v) => void updateSettings({ autoRouting: v })} label="Automatic model routing" description="Choose the general, coding, reasoning or vision model per request. When off, the general model answers everything (images still use the vision model)." />
          <Toggle checked={settings.singleModelResidency} onChange={(v) => void updateSettings({ singleModelResidency: v })} label="Keep only one model in memory" description="Unload other models before loading a new one. Recommended for 8 GB GPUs." />
          <Toggle checked={settings.knowledgeEnabled} onChange={(v) => void updateSettings({ knowledgeEnabled: v })} label="Use the knowledge library" description="Add relevant passages from your syllabus and notes (Knowledge view in the activity bar) to each request." />
          <Toggle checked={settings.autoApplyEdits} onChange={(v) => void updateSettings({ autoApplyEdits: v })} label="Apply AI file edits automatically" description="Write created and edited files without asking. Deletes, renames and commands always ask first. Applied changes can be undone from the chat." />
        </Section>

        <Section id="editor" title="Editor & terminal">
          <Field label="Editor font size">
            <TextInput type="number" min={9} max={32} className="w-[90px]" value={settings.editorFontSize} onChange={(e) => void updateSettings({ editorFontSize: Math.max(9, Math.min(32, Number(e.target.value) || 14)) })} />
          </Field>
          <Field label="Terminal font size">
            <TextInput type="number" min={9} max={32} className="w-[90px]" value={settings.terminalFontSize} onChange={(e) => void updateSettings({ terminalFontSize: Math.max(9, Math.min(32, Number(e.target.value) || 13)) })} />
          </Field>
          <Field label="Terminal shell" description="Leave empty for the default (PowerShell on Windows, your login shell elsewhere). Takes effect for new terminals.">
            <TextInput placeholder={platform === 'win32' ? 'powershell.exe' : '/bin/bash'} defaultValue={settings.terminalShell} onBlur={(e) => void updateSettings({ terminalShell: e.target.value.trim() })} />
          </Field>
          <Field label="Default workspace" description="Opened at startup when no previous folder is remembered.">
            <div className="flex gap-2">
              <TextInput readOnly value={settings.defaultWorkspace ?? ''} placeholder="None" />
              <Button
                variant="secondary"
                onClick={async () => {
                  const d = await api.fs.pickFolder()
                  if (d) void updateSettings({ defaultWorkspace: d })
                }}
              >
                Choose…
              </Button>
              {settings.defaultWorkspace && <IconButton icon={X} label="Clear default workspace" onClick={() => void updateSettings({ defaultWorkspace: null })} />}
            </div>
          </Field>
        </Section>

        <Section id="runtimes" title="Runtimes">
          <p className="max-w-[640px] text-ui-sm text-muted">Code runs with your user account on this computer. Treat code from the AI or the internet as untrusted and review it before running.</p>
          <div className="flex max-w-[760px] flex-col">
            {runtimes?.map((r) => (
              <div key={r.language} className="flex items-start gap-2 border-b border-line py-1.5 text-ui-sm">
                {r.available ? <CheckCircle2 size={14} className="mt-[2px] text-success" /> : <XCircle size={14} className="mt-[2px] text-error" />}
                <span className="w-[160px]">{r.label}</span>
                <span className="flex-1 text-muted">{r.available ? `${r.command} — ${r.version}` : r.installHint}</span>
              </div>
            )) ?? <Spinner />}
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} className="self-start" onClick={() => void api.run.runtimes().then(setRuntimes)}>
            Detect again
          </Button>
        </Section>

        <Section id="memory" title="Project memory">
          {!workspace ? (
            <p className="text-ui-sm text-muted">Open a folder to see its memory.</p>
          ) : (
            <>
              <p className="max-w-[640px] text-ui-sm text-muted">
                The assistant keeps a local index of this workspace and a short memory so follow-up questions do not need the files again. {indexStatus ? `${indexStatus.files} files, ${indexStatus.chunks || 'n/a'} chunks indexed${indexStatus.lastIndexed ? `, last ${new Date(indexStatus.lastIndexed).toLocaleString()}` : ''}.` : ''}
              </p>
              <Field label="Summary (generated from the files)">
                <pre className="max-h-[180px] overflow-auto rounded-[2px] border border-line bg-sidebar p-2 font-mono text-ui-xs whitespace-pre-wrap">{memory?.summary || 'Not indexed yet.'}</pre>
              </Field>
              <Field label="Notes" description="Facts the assistant should remember about this project. It also adds short notes when it proposes files.">
                <textarea className="h-[110px] w-full rounded-[2px] border border-input-border bg-input p-2 font-mono text-ui-sm text-fg outline-none focus:border-focus" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Button size="sm" variant="secondary" className="mt-1" onClick={() => void api.memory.setNotes(notes).then(() => toast('success', 'Notes saved'))}>
                  Save notes
                </Button>
              </Field>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={RefreshCw} busy={indexStatus?.indexing} onClick={() => void api.memory.reindex()}>
                  Re-index now
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={Trash2}
                  onClick={async () => {
                    if (await confirm('Clear project memory', 'Delete the index, summary and notes for this workspace? Your files are not touched.', 'Clear', true)) {
                      await api.memory.clear()
                      setMemory(null)
                      setNotes('')
                      toast('info', 'Project memory cleared')
                    }
                  }}
                >
                  Clear project memory
                </Button>
              </div>
            </>
          )}
        </Section>

        <Section id="conversations" title="Conversations">
          <p className="text-ui-sm text-muted">{conversations.length} conversation(s), stored locally in SQLite.</p>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            className="self-start"
            disabled={!conversations.length}
            onClick={async () => {
              if (await confirm('Delete all conversations', `Delete all ${conversations.length} conversations and their messages? This cannot be undone.`, 'Delete all', true)) {
                for (const c of conversations) await deleteConversation(c.id)
              }
            }}
          >
            Delete all conversations
          </Button>
        </Section>

        <Section id="about" title="About">
          <div className="grid max-w-[640px] grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-ui-sm">
            <span className="text-muted">Version</span>
            <span>{info?.version}</span>
            <span className="text-muted">Electron</span>
            <span>
              {info?.electron} (Chromium {info?.chrome}, Node {info?.node})
            </span>
            <span className="text-muted">Platform</span>
            <span>{info?.platform}</span>
            <span className="text-muted">Data folder</span>
            <span className="break-all">{info?.userData}</span>
            <span className="text-muted">Database</span>
            <span className="break-all">{info?.dbPath}</span>
          </div>
          <p className="max-w-[640px] text-ui-sm text-muted">
            Everything runs locally: AI inference through Ollama, document processing, code execution and chat history. No telemetry, no accounts, no cloud AI. Internet is only needed to install Ollama and download models.
          </p>
        </Section>
      </div>
    </div>
  )
}

function PullBar({ model }: { model: string }) {
  const p = useApp((s) => s.pulls[model])
  if (!p) return null
  const pct = p.total ? Math.round(((p.completed ?? 0) / p.total) * 100) : null
  return (
    <span className="flex items-center gap-2 text-ui-xs">
      <span className="relative h-[6px] w-[160px] overflow-hidden rounded-[3px] bg-badge">
        <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct ?? 0}%` }} />
      </span>
      <span className="w-[200px] truncate text-muted">
        {p.error ? <span className="text-error">{p.error}</span> : `${p.status}${pct != null ? ` ${pct}%` : ''}${p.total ? ` of ${formatBytes(p.total)}` : ''}`}
      </span>
      {!p.done && <IconButton icon={X} size={12} label="Cancel download" onClick={() => void api.ollama.cancelPull(model)} />}
    </span>
  )
}
