import { AlertCircle, Database, Loader2, Play, Square } from 'lucide-react'
import { PROFILE_PRESETS } from '@shared/profiles'
import { useApp, useActiveTab } from '@/store/app'

export function StatusBar() {
  const indexStatus = useApp((s) => s.indexStatus)
  const runId = useApp((s) => s.runId)
  const problems = useApp((s) => s.problems)
  const settings = useApp((s) => s.settings)
  const cursor = useApp((s) => s.cursor)
  const stream = useApp((s) => (s.settings?.aiSidebarVisible ? s.stream : null)) // nothing AI-related shows while the assistant is hidden
  const tab = useActiveTab()
  const { togglePanel, stopRun, runActiveFile } = useApp.getState()
  const item = 'flex h-full cursor-pointer items-center gap-1 px-2 hover:bg-white/15'
  return (
    <footer className="flex h-[22px] shrink-0 items-center bg-statusbar text-ui-xs text-statusbar-fg">
      <button type="button" className={item} onClick={() => togglePanel('problems')} title="Problems">
        <AlertCircle size={13} /> {problems.filter((p) => p.severity === 'error').length}
      </button>
      {runId ? (
        <button type="button" className={item} onClick={() => void stopRun()} title="Stop the running program">
          <Square size={11} /> Running… stop
        </button>
      ) : (
        tab?.kind === 'file' && (
          <button type="button" className={item} onClick={() => void runActiveFile()} title="Run active file (F5)">
            <Play size={12} /> Run
          </button>
        )
      )}
      {indexStatus?.workspace && (
        <span className="flex items-center gap-1 px-2" title="Local project index used by the assistant">
          {indexStatus.indexing ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
          {indexStatus.indexing ? `Indexing… ${indexStatus.files}` : `${indexStatus.files} files indexed`}
        </span>
      )}
      {stream && (
        <span className="flex items-center gap-1 px-2">
          <Loader2 size={12} className="animate-spin" /> AI {stream.status || 'responding…'}
        </span>
      )}
      <div className="flex-1" />
      {tab?.kind === 'file' && (
        <>
          <span className="px-2">
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <span className="px-2">UTF-8</span>
          <span className="px-2 capitalize">{tab.language}</span>
        </>
      )}
      {settings && <span className="px-2">{PROFILE_PRESETS[settings.profile].label} · ctx {settings.numCtx}</span>}
    </footer>
  )
}
