import { useEffect, useState } from 'react'
import { CheckCircle2, Play, RefreshCw, Sparkles, Square, XCircle } from 'lucide-react'
import type { RuntimeInfo } from '@shared/types'
import { useApp } from '@/store/app'
import { api, basename, RUNNABLE } from '@/lib/api'
import { Button, IconButton, SectionHeader, Spinner } from '../ui'

export function RunView() {
  const runId = useApp((s) => s.runId)
  const lastRun = useApp((s) => s.lastRun)
  const activeFile = useApp((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.kind === 'file' ? t.path : null
  })
  const { runActiveFile, stopRun, fixWithAI, togglePanel } = useApp.getState()
  const [runtimes, setRuntimes] = useState<RuntimeInfo[] | null>(null)
  const [loading, setLoading] = useState(false)

  const detect = async () => {
    setLoading(true)
    try {
      setRuntimes(await api.run.runtimes())
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void detect()
  }, [])

  const runnable = activeFile && RUNNABLE.test(activeFile)

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="Run and Debug" />
      <div className="flex flex-col gap-2 px-4 pb-3">
        {runId ? (
          <Button variant="danger" icon={Square} onClick={() => void stopRun()}>
            Stop
          </Button>
        ) : (
          <Button icon={Play} disabled={!runnable} onClick={() => void runActiveFile()} title="F5">
            {activeFile ? `Run ${basename(activeFile)}` : 'Run Active File'}
          </Button>
        )}
        {!runnable && <p className="text-ui-sm text-muted">Open a .py, .js, .ts, .cpp, .c or .java file to run it. Programs run on your computer with your user permissions — only run code you trust.</p>}
        {lastRun && (
          <div className="rounded-[2px] border border-line p-2 text-ui-sm">
            <div className="flex items-center gap-1.5">
              {lastRun.status === 'success' ? <CheckCircle2 size={14} className="text-success" /> : <XCircle size={14} className="text-error" />}
              <span className="truncate font-semibold">{basename(lastRun.file)}</span>
            </div>
            <div className="mt-1 text-muted">
              {lastRun.status} · exit {lastRun.exitCode ?? 'none'} · {(lastRun.durationMs / 1000).toFixed(2)}s
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => togglePanel('output')}>
                Show Output
              </Button>
              {lastRun.status !== 'success' && lastRun.status !== 'killed' && (
                <Button size="sm" icon={Sparkles} onClick={() => void fixWithAI()}>
                  Fix Error with AI
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between pr-2 pl-4 text-ui-xs uppercase">
        <span>Runtimes</span>
        <IconButton icon={RefreshCw} label="Detect runtimes again" onClick={() => void detect()} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {loading && !runtimes && <Spinner />}
        {runtimes?.map((r) => (
          <div key={r.language} className="border-b border-line py-2 text-ui-sm last:border-0">
            <div className="flex items-center gap-1.5">
              {r.available ? <CheckCircle2 size={13} className="text-success" /> : <XCircle size={13} className="text-error" />}
              <span className="text-fg">{r.label}</span>
            </div>
            <div className="selectable mt-0.5 truncate text-ui-xs text-muted" title={r.version}>
              {r.available ? r.version : r.installHint}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
