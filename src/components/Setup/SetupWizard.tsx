import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Cpu, Download, ExternalLink, HardDrive, RefreshCw, Server, XCircle } from 'lucide-react'
import type { HardwareProfile, SetupProgress, SetupStatus } from '@shared/types'
import { PROFILE_PRESETS } from '@shared/profiles'
import { useApp } from '@/store/app'
import { api, errorMessage, formatBytes } from '@/lib/api'
import { Badge, Button, Modal, Spinner } from '../ui'

function Bar({ p }: { p?: SetupProgress }) {
  if (!p) return null
  const pct = p.total ? Math.min(100, Math.round(((p.completed ?? 0) / p.total) * 100)) : null
  return (
    <div className="mt-1 flex items-center gap-2 text-ui-xs text-muted">
      {pct !== null && (
        <span className="relative h-[6px] w-[180px] shrink-0 overflow-hidden rounded-[3px] bg-badge">
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className={`truncate ${p.error ? 'text-error' : ''}`}>
        {p.status}
        {pct !== null ? ` · ${pct}%${p.total ? ` of ${formatBytes(p.total)}` : ''}` : ''}
      </span>
    </div>
  )
}

function Step({ n, icon: Icon, title, done, children }: { n: number; icon: typeof Cpu; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line py-3 last:border-0">
      <div className={`flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-ui-xs ${done ? 'bg-success/20 text-success' : 'bg-badge text-fg'}`}>
        {done ? <CheckCircle2 size={15} /> : n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-ui font-semibold text-fg-strong">
          <Icon size={14} strokeWidth={1.6} /> {title}
        </div>
        {children}
      </div>
    </div>
  )
}

export function SetupWizard() {
  const open = useApp((s) => s.setupOpen)
  const { updateSettings, refreshOllama, toast } = useApp.getState()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [progress, setProgress] = useState<Record<string, SetupProgress>>({})
  const [busy, setBusy] = useState<'ollama' | 'models' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.setup.status())
    } catch (e) {
      setMessage(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    return api.setup.onProgress((p) => setProgress((prev) => ({ ...prev, [p.step]: p })))
  }, [open, refresh])

  if (!open) return null

  const close = (done: boolean) => {
    if (busy) void api.setup.cancel()
    void updateSettings({ setupDone: done || !!useApp.getState().settings?.setupDone })
    useApp.setState({ setupOpen: false })
    void refreshOllama()
  }

  const chooseProfile = async (p: HardwareProfile) => {
    const pr = PROFILE_PRESETS[p]
    await updateSettings({ profile: p, numCtx: pr.numCtx, temperature: pr.temperature, roles: pr.roles })
    await refresh()
  }

  const installOllama = async () => {
    setBusy('ollama')
    setMessage(null)
    try {
      const r = await api.setup.installOllama()
      setMessage(r.ok ? null : r.message)
    } catch (e) {
      setMessage(errorMessage(e))
    } finally {
      setBusy(null)
      await refresh()
      void refreshOllama()
    }
  }

  const missing = status?.required.filter((m) => !m.installed) ?? []
  const missingGB = missing.reduce((n, m) => n + (m.sizeGB ?? 0), 0)
  const downloadModels = async () => {
    setBusy('models')
    setMessage(null)
    try {
      const r = await api.setup.pullModels(missing.map((m) => m.name))
      if (!r.ok && r.failed.length) setMessage(`Not installed: ${r.failed.join(', ')}. Check the internet connection and press Download again (it resumes).`)
      else toast('success', 'All models are installed')
    } catch (e) {
      setMessage(errorMessage(e))
    } finally {
      setBusy(null)
      await refresh()
      void refreshOllama()
    }
  }

  const ollamaReady = !!status?.ollamaRunning
  const allReady = ollamaReady && missing.length === 0

  return (
    <Modal
      title="Set up LocalCode AI Studio"
      width={640}
      onClose={() => close(false)}
      footer={
        <>
          <span className="mr-auto self-center text-ui-xs text-muted">Internet is needed only for this setup. Afterwards everything runs offline.</span>
          <Button variant="secondary" onClick={() => close(false)}>
            {allReady ? 'Close' : 'Skip for now'}
          </Button>
          <Button disabled={!allReady} onClick={() => close(true)}>
            Finish
          </Button>
        </>
      }
    >
      {!status ? (
        <div className="flex items-center gap-2 py-6 text-muted">
          <Spinner /> Checking this computer…
        </div>
      ) : (
        <div>
          <Step n={1} icon={Cpu} title="Your computer" done>
            <div className="mb-2 text-ui-sm text-muted">{status.hardwareSummary}</div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(status.presets) as HardwareProfile[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!!busy}
                  onClick={() => void chooseProfile(p)}
                  className={`w-[180px] cursor-pointer rounded-[4px] border p-2 text-left disabled:cursor-default ${status.profile === p ? 'border-focus bg-selected-focus/40' : 'border-line-strong hover:bg-hover'}`}
                >
                  <div className="flex items-center gap-1 text-ui-sm font-semibold text-fg-strong">
                    {status.presets[p].label}
                    {status.recommendedProfile === p && <Badge tone="info">recommended</Badge>}
                  </div>
                  <div className="text-ui-xs text-muted">≈ {status.presets[p].totalGB.toFixed(0)} GB of models</div>
                </button>
              ))}
            </div>
          </Step>

          <Step n={2} icon={Server} title="Ollama (runs the AI models)" done={ollamaReady}>
            {ollamaReady ? (
              <div className="text-ui-sm text-success">Ollama {status.ollamaVersion} is running.</div>
            ) : (
              <>
                <div className="mb-2 text-ui-sm text-muted">{status.ollamaPath ? 'Ollama is installed but not running.' : 'Ollama is not installed yet (about 1 GB download).'}</div>
                <div className="flex flex-wrap gap-2">
                  {status.platform === 'win32' || status.platform === 'darwin' || status.ollamaPath ? (
                    <Button icon={Download} busy={busy === 'ollama'} disabled={!!busy && busy !== 'ollama'} onClick={() => void installOllama()}>
                      {status.ollamaPath ? 'Start Ollama' : 'Install Ollama'}
                    </Button>
                  ) : (
                    <Button icon={ExternalLink} variant="secondary" onClick={() => void api.app.openExternal('https://ollama.com/download')}>
                      Open ollama.com/download
                    </Button>
                  )}
                  <Button variant="secondary" icon={RefreshCw} disabled={!!busy} onClick={() => void refresh()}>
                    Check again
                  </Button>
                </div>
                {busy === 'ollama' && <Bar p={progress.ollama} />}
              </>
            )}
          </Step>

          <Step n={3} icon={HardDrive} title="AI models" done={ollamaReady && missing.length === 0}>
            <div className="flex flex-col gap-1">
              {status.required.map((m) => (
                <div key={m.name} className="text-ui-sm">
                  <div className="flex items-center gap-2">
                    {m.installed ? <CheckCircle2 size={13} className="text-success" /> : <XCircle size={13} className="text-muted" />}
                    <span className="w-[170px] font-mono text-ui-xs">{m.name}</span>
                    <span className="text-ui-xs text-muted">{m.sizeGB ? `${m.sizeGB} GB` : ''}</span>
                    {m.installed && <Badge tone="success">installed</Badge>}
                  </div>
                  {!m.installed && busy === 'models' && <Bar p={progress[m.name]} />}
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <div className="mt-2 flex gap-2">
                <Button icon={Download} busy={busy === 'models'} disabled={!ollamaReady || (!!busy && busy !== 'models')} onClick={() => void downloadModels()}>
                  Download {missing.length} model{missing.length === 1 ? '' : 's'} ({missingGB.toFixed(1)} GB)
                </Button>
                {busy === 'models' && (
                  <Button variant="secondary" onClick={() => void api.setup.cancel()}>
                    Pause
                  </Button>
                )}
              </div>
            )}
            {!ollamaReady && missing.length > 0 && <div className="mt-1 text-ui-xs text-muted">Install Ollama first.</div>}
          </Step>
          {message && <div className="selectable mt-2 rounded-[2px] border border-warning/50 bg-warning/10 p-2 text-ui-sm">{message}</div>}
        </div>
      )}
    </Modal>
  )
}
