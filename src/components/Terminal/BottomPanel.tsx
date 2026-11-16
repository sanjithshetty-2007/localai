import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { AlertCircle, AlertTriangle, ChevronDown, Plus, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useApp, type PanelTab } from '@/store/app'
import { api, basename, relativePath } from '@/lib/api'
import { Button, EmptyState, IconButton, TextInput } from '../ui'

const XTERM_THEMES = {
  dark: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', selectionBackground: '#264f78' },
  light: { background: '#ffffff', foreground: '#333333', cursor: '#000000', selectionBackground: '#add6ff' }
}

function TerminalView({ visible }: { visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idRef = useRef<string | null>(null)
  const theme = useApp((s) => s.settings?.theme ?? 'dark')
  const fontSize = useApp((s) => s.settings?.terminalFontSize ?? 13)
  const workspace = useApp((s) => s.workspace)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!host.current) return
    const term = new XTerm({
      fontFamily: "Consolas, 'Cascadia Code', Menlo, monospace",
      fontSize,
      theme: XTERM_THEMES[theme],
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    termRef.current = term
    fitRef.current = fit
    try {
      fit.fit()
    } catch {
      /* hidden */
    }
    let disposed = false
    setError(null)
    void api.terminal.create(term.cols, term.rows).then((r) => {
      if (disposed) {
        if ('id' in r) api.terminal.kill(r.id)
        return
      }
      if ('error' in r) {
        setError(r.error)
        return
      }
      idRef.current = r.id
    })
    const offData = api.terminal.onData((id, data) => {
      if (id === idRef.current) {
        term.write(data)
        useApp.getState().appendTerminal(data)
      }
    })
    const offExit = api.terminal.onExit((id, code) => {
      if (id === idRef.current) {
        term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
        idRef.current = null
      }
    })
    const sub = term.onData((d) => idRef.current && api.terminal.write(idRef.current, d))
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        if (idRef.current) api.terminal.resize(idRef.current, term.cols, term.rows)
      } catch {
        /* not visible */
      }
    })
    ro.observe(host.current)
    return () => {
      disposed = true
      ro.disconnect()
      sub.dispose()
      offData()
      offExit()
      if (idRef.current) api.terminal.kill(idRef.current)
      idRef.current = null
      term.dispose()
    }
    // A new workspace restarts the shell in the new folder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = XTERM_THEMES[theme]
      termRef.current.options.fontSize = fontSize
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
    }
  }, [theme, fontSize])

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        try {
          fitRef.current?.fit()
          termRef.current?.focus()
        } catch {
          /* ignore */
        }
      }, 0)
    }
  }, [visible])

  return (
    <div className={`h-full ${visible ? '' : 'hidden'}`}>
      {error ? (
        <div className="p-3 text-ui-sm text-error">
          {error}
          <div className="mt-2 text-muted">Program output still appears in the Output tab when you run a file.</div>
        </div>
      ) : (
        <div ref={host} className="h-full" />
      )}
    </div>
  )
}

function OutputView() {
  const output = useApp((s) => s.output)
  const runId = useApp((s) => s.runId)
  const lastRun = useApp((s) => s.lastRun)
  const runCommand = useApp((s) => s.runCommand)
  const { sendStdin, fixWithAI } = useApp.getState()
  const [input, setInput] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])
  const failed = !runId && lastRun && lastRun.status !== 'success' && lastRun.status !== 'killed'
  return (
    <div className="flex h-full flex-col">
      {failed && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-error/10 px-3 py-1.5 text-ui-sm">
          <AlertCircle size={14} className="text-error" />
          <span className="truncate">
            {basename(lastRun.file)} {lastRun.status === 'compile-error' ? 'failed to compile' : lastRun.status === 'missing-runtime' ? 'could not run' : `exited with code ${lastRun.exitCode}`}
            {lastRun.problems[0] ? ` — line ${lastRun.problems[0].line}: ${lastRun.problems[0].message}` : ''}
          </span>
          <div className="flex-1" />
          {lastRun.status !== 'missing-runtime' && (
            <Button size="sm" icon={Sparkles} onClick={() => void fixWithAI()}>
              Fix Error with AI
            </Button>
          )}
        </div>
      )}
      <div ref={scroller} className="selectable min-h-0 flex-1 overflow-auto px-3 py-1 font-mono text-ui-sm whitespace-pre-wrap">
        {output.length === 0 && <div className="text-muted">Run a file (F5) to see its output here.</div>}
        {output.map((l, i) => (
          <span key={i} className={l.stream === 'stderr' ? 'text-error' : l.stream === 'system' ? 'text-muted' : 'text-fg'}>
            {l.text}
          </span>
        ))}
      </div>
      {runId && (
        <form
          className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1"
          onSubmit={(e) => {
            e.preventDefault()
            sendStdin(input + '\n')
            setInput('')
          }}
        >
          <span className="truncate text-ui-xs text-muted" title={runCommand}>
            stdin ›
          </span>
          <TextInput autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type input for the running program and press Enter" className="font-mono" />
        </form>
      )}
    </div>
  )
}

function ProblemsView() {
  const problems = useApp((s) => s.problems)
  const workspace = useApp((s) => s.workspace)
  const lastRun = useApp((s) => s.lastRun)
  const { openFile, fixWithAI } = useApp.getState()
  if (!problems.length) return <EmptyState title="No problems detected in the last run." />
  return (
    <div className="h-full overflow-auto py-1">
      {problems.map((p, i) => (
        <div key={i} className="flex cursor-pointer items-center gap-2 px-3 py-0.5 text-ui hover:bg-hover" onClick={() => void openFile(p.file, p.line)}>
          {p.severity === 'error' ? <AlertCircle size={14} className="shrink-0 text-error" /> : <AlertTriangle size={14} className="shrink-0 text-warning" />}
          <span className="selectable truncate">{p.message}</span>
          <span className="shrink-0 text-ui-sm text-muted">
            {relativePath(workspace, p.file)} [Ln {p.line}
            {p.column ? `, Col ${p.column}` : ''}]
          </span>
        </div>
      ))}
      {lastRun && lastRun.status !== 'success' && (
        <div className="px-3 pt-2">
          <Button size="sm" icon={Sparkles} onClick={() => void fixWithAI()}>
            Fix Error with AI
          </Button>
        </div>
      )}
    </div>
  )
}

function DebugView() {
  const logs = useApp((s) => s.logs)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])
  return (
    <div ref={scroller} className="selectable h-full overflow-auto px-3 py-1 font-mono text-ui-sm">
      {logs.length === 0 && <div className="text-muted">Application events (model loading, runs, errors) appear here.</div>}
      {logs.map((l, i) => (
        <div key={i} className={l.level === 'error' ? 'text-error' : l.level === 'warn' ? 'text-warning' : 'text-fg'}>
          <span className="text-muted">{new Date(l.time).toLocaleTimeString()} </span>
          {l.text}
        </div>
      ))}
    </div>
  )
}

export function BottomPanel() {
  const panelTab = useApp((s) => s.panelTab)
  const runId = useApp((s) => s.runId)
  const problems = useApp((s) => s.problems)
  const { togglePanel, stopRun } = useApp.getState()
  const [termKey, setTermKey] = useState(0)
  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: 'problems', label: 'Problems' },
    { id: 'output', label: 'Output' },
    { id: 'debug', label: 'Debug Console' },
    { id: 'terminal', label: 'Terminal' }
  ]
  return (
    <div className="flex h-full flex-col border-t border-line bg-panel">
      <div className="flex h-[35px] shrink-0 items-center gap-1 pr-2 pl-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => useApp.setState({ panelTab: t.id })}
            className={`relative flex h-full cursor-pointer items-center gap-1 px-2 text-ui-xs uppercase ${panelTab === t.id ? 'text-fg-strong' : 'text-muted hover:text-fg'}`}
          >
            {t.label}
            {t.id === 'problems' && problems.length > 0 && <span className="rounded-[8px] bg-badge px-1.5 text-ui-xs normal-case">{problems.length}</span>}
            {panelTab === t.id && <span className="absolute inset-x-2 bottom-[4px] h-[1px] bg-fg-strong" />}
          </button>
        ))}
        <div className="flex-1" />
        {runId && <IconButton icon={Square} label="Stop running program" onClick={() => void stopRun()} />}
        {panelTab === 'terminal' && <IconButton icon={Plus} label="Restart terminal" onClick={() => setTermKey((k) => k + 1)} />}
        {panelTab === 'output' && <IconButton icon={Trash2} label="Clear output" onClick={() => useApp.setState({ output: [] })} />}
        {panelTab === 'debug' && <IconButton icon={Trash2} label="Clear console" onClick={() => useApp.setState({ logs: [] })} />}
        <IconButton icon={ChevronDown} label="Hide panel (Ctrl+J)" onClick={() => togglePanel()} />
        <IconButton icon={X} label="Close panel" onClick={() => useApp.setState({ panelVisible: false })} />
      </div>
      <div className="min-h-0 flex-1">
        <TerminalView key={termKey} visible={panelTab === 'terminal'} />
        {panelTab === 'output' && <OutputView />}
        {panelTab === 'problems' && <ProblemsView />}
        {panelTab === 'debug' && <DebugView />}
      </div>
    </div>
  )
}
