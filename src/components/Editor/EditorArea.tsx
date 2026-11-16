import { useEffect, useRef, useState } from 'react'
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react'
import { Check, Columns2, FolderOpen, MessageSquare, Play, Settings as SettingsIcon, Sparkles, X } from 'lucide-react'
import { monaco, modelUri, monacoTheme } from '@/editor/monaco'
import { useApp, isDirty, type DiffTab, type FileTab, type Tab } from '@/store/app'
import { relativePath, RUNNABLE } from '@/lib/api'
import { Button, IconButton } from '../ui'
import { FileIcon } from '../fileIcon'
import { Logo } from '../TitleBar'
import { SettingsView } from '../Settings/SettingsView'

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const { setActiveTab, closeTab } = useApp.getState()
  const dirty = isDirty(tab)
  const workspace = useApp((s) => s.workspace)
  return (
    <div
      role="tab"
      aria-selected={active}
      title={tab.kind === 'settings' ? 'Settings' : relativePath(workspace, tab.path)}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          void closeTab(tab.id)
        } else setActiveTab(tab.id)
      }}
      className={`group relative flex h-[35px] min-w-[100px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line pr-1 pl-3 text-ui ${
        active ? 'bg-tab-active text-fg-strong' : 'bg-tab text-muted hover:text-fg'
      }`}
    >
      {active && <span className="absolute inset-x-0 top-0 h-[1px] bg-accent" />}
      {tab.kind === 'settings' ? <SettingsIcon size={15} strokeWidth={1.6} /> : tab.kind === 'diff' ? <Columns2 size={15} strokeWidth={1.6} className="text-info" /> : <FileIcon name={tab.name} />}
      <span className={`truncate ${tab.kind === 'diff' ? 'italic' : ''}`}>{tab.name}</span>
      <button
        type="button"
        aria-label={`Close ${tab.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => void closeTab(tab.id)}
        className="ml-auto flex h-[20px] w-[20px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] hover:bg-hover"
      >
        {dirty ? (
          <>
            <span className="h-[8px] w-[8px] rounded-full bg-fg group-hover:hidden" />
            <X size={14} className="hidden group-hover:block" />
          </>
        ) : (
          <X size={14} className={active ? '' : 'invisible group-hover:visible'} />
        )}
      </button>
    </div>
  )
}

function FileEditor({ tab }: { tab: FileTab }) {
  const settings = useApp((s) => s.settings)!
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const { updateContent } = useApp.getState()

  useEffect(() => {
    const ed = editorRef.current
    if (ed && tab.revealLine) {
      ed.revealLineInCenter(tab.revealLine)
      ed.setPosition({ lineNumber: tab.revealLine, column: 1 })
      ed.focus()
    }
  }, [tab.revealLine, tab.path])

  // Show problems from the last run as squiggles in the editor.
  const problems = useApp((s) => s.problems)
  useEffect(() => {
    const model = monaco.editor.getModel(modelUri(tab.path))
    if (!model) return
    const mine = problems.filter((p) => p.file.replace(/\\/g, '/').toLowerCase() === tab.path.replace(/\\/g, '/').toLowerCase())
    monaco.editor.setModelMarkers(
      model,
      'localcode-run',
      mine.map((p) => {
        const line = Math.min(Math.max(1, p.line), model.getLineCount())
        return {
          severity: p.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: p.message,
          startLineNumber: line,
          endLineNumber: line,
          startColumn: p.column ?? model.getLineFirstNonWhitespaceColumn(line) ?? 1,
          endColumn: model.getLineMaxColumn(line)
        }
      })
    )
  }, [problems, tab.path, tab.content])

  const onMount: OnMount = (ed) => {
    editorRef.current = ed
    if (tab.revealLine) {
      ed.revealLineInCenter(tab.revealLine)
      ed.setPosition({ lineNumber: tab.revealLine, column: 1 })
    }
    ed.focus()
    ed.onDidChangeCursorPosition((e) => useApp.setState({ cursor: { line: e.position.lineNumber, column: e.position.column } }))
    ed.onDidChangeCursorSelection(() => {
      const model = ed.getModel()
      const sel = ed.getSelection()
      if (!model || !sel || sel.isEmpty()) {
        useApp.setState({ selection: null })
        return
      }
      useApp.setState({ selection: { text: model.getValueInRange(sel), startLine: sel.startLineNumber, endLine: sel.endLineNumber } })
    })
    const ask = (prompt: string) => () => useApp.getState().focusChat(prompt)
    ed.addAction({ id: 'ai.explain', label: 'AI: Explain Selection', contextMenuGroupId: '0_ai', contextMenuOrder: 1, run: ask('Explain the selected code.') })
    ed.addAction({ id: 'ai.fix', label: 'AI: Find Bugs in Selection', contextMenuGroupId: '0_ai', contextMenuOrder: 2, run: ask('Find bugs in the selected code and propose a fix for this file.') })
    ed.addAction({ id: 'ai.refactor', label: 'AI: Improve Selection', contextMenuGroupId: '0_ai', contextMenuOrder: 3, run: ask('Refactor the selected code for readability and propose the updated file.') })
    ed.addAction({
      id: 'app.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => void useApp.getState().saveFile(tab.path)
    })
    ed.addAction({ id: 'app.run', label: 'Run File', keybindings: [monaco.KeyCode.F5], run: () => void useApp.getState().runPath(tab.path) })
  }

  return (
    <Editor
      key={tab.path}
      path={modelUri(tab.path).toString()}
      defaultLanguage={tab.language}
      language={tab.language}
      defaultValue={tab.content}
      theme={monacoTheme(settings.theme)}
      onMount={onMount}
      onChange={(v) => updateContent(tab.path, v ?? '')}
      loading={<div className="p-4 text-ui text-muted">Loading editor…</div>}
      options={{
        fontSize: settings.editorFontSize,
        fontFamily: "Consolas, 'Cascadia Code', 'SF Mono', Menlo, monospace",
        minimap: { enabled: true },
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        tabSize: 4,
        detectIndentation: true,
        autoIndent: 'full',
        formatOnPaste: false,
        wordWrap: 'off',
        stickyScroll: { enabled: true }
      }}
    />
  )
}

function DiffView({ tab }: { tab: DiffTab }) {
  const settings = useApp((s) => s.settings)!
  const cs = useApp((s) => s.changeSets[tab.changeSetId])
  const workspace = useApp((s) => s.workspace)
  const { applyChanges, rejectChanges } = useApp.getState()
  const [sideBySide, setSideBySide] = useState(true)
  // The wrapper keeps its models (avoids a Monaco disposal race); dispose them after the widget is gone.
  useEffect(
    () => () => {
      setTimeout(() => {
        monaco.editor.getModel(monaco.Uri.parse(`diff-original://${tab.itemId}`))?.dispose()
        monaco.editor.getModel(monaco.Uri.parse(`diff-modified://${tab.itemId}`))?.dispose()
      }, 0)
    },
    [tab.itemId]
  )
  const item = cs?.items.find((i) => i.id === tab.itemId)
  const pending = item?.status === 'pending' || item?.status === 'failed'
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[32px] shrink-0 items-center gap-2 border-b border-line bg-editor px-3 text-ui">
        <span className="truncate text-fg-strong">{relativePath(workspace, tab.path)}</span>
        {item && (
          <span className="text-ui-sm">
            <span className="text-ins">+{item.added ?? 0}</span> <span className="text-del">−{item.removed ?? 0}</span>
          </span>
        )}
        <span className="text-ui-sm text-muted">{item?.original === null ? 'new file' : 'proposed by AI'} · {item?.status ?? 'unknown'}</span>
        <div className="flex-1" />
        <IconButton icon={Columns2} label={sideBySide ? 'Inline view' : 'Side-by-side view'} active={sideBySide} onClick={() => setSideBySide(!sideBySide)} />
        {pending && (
          <>
            <Button size="sm" variant="secondary" icon={X} onClick={() => void rejectChanges(tab.changeSetId, [tab.itemId])}>
              Reject
            </Button>
            <Button size="sm" icon={Check} onClick={() => void applyChanges(tab.changeSetId, [tab.itemId])}>
              Accept
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <DiffEditor
          originalModelPath={`diff-original://${tab.itemId}`}
          modifiedModelPath={`diff-modified://${tab.itemId}`}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          original={tab.original}
          modified={tab.proposed}
          language={tab.language}
          theme={monacoTheme(settings.theme)}
          options={{
            readOnly: true,
            renderSideBySide: sideBySide,
            fontSize: settings.editorFontSize,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderOverviewRuler: true
          }}
        />
      </div>
    </div>
  )
}

function Welcome() {
  const workspace = useApp((s) => s.workspace)
  const ollama = useApp((s) => s.ollama)
  const { openFolder, focusChat, openSettings } = useApp.getState()
  const shortcuts: Array<[string, string]> = [
    ['Ctrl+O', 'Open folder'],
    ['Ctrl+S', 'Save file'],
    ['F5', 'Run active file'],
    ['Ctrl+L', 'Focus AI chat'],
    ['Ctrl+B', 'Toggle sidebar'],
    ['Ctrl+J', 'Toggle panel'],
    ['Ctrl+Shift', 'Hide / show AI assistant'],
    ['Ctrl+Shift+F', 'Search in files']
  ]
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-editor">
      <div className="w-[440px] max-w-full px-6">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <div className="text-[22px] font-light text-fg-strong">LocalCode AI Studio</div>
            <div className="text-ui text-muted">One assistant. One workspace. Everything local.</div>
          </div>
        </div>
        {ollama && !ollama.connected && (
          <div className="mb-4 rounded-[2px] border border-warning/50 bg-warning/10 p-3 text-ui-sm">
            Ollama is not running, so the assistant cannot answer yet.{' '}
            <button type="button" className="cursor-pointer text-info underline" onClick={openSettings}>
              Open setup
            </button>
          </div>
        )}
        <div className="mb-6 flex flex-col gap-1 text-ui">
          {!workspace && (
            <button type="button" className="flex cursor-pointer items-center gap-2 text-info hover:underline" onClick={() => void openFolder()}>
              <FolderOpen size={15} /> Open Folder…
            </button>
          )}
          <button type="button" className="flex cursor-pointer items-center gap-2 text-info hover:underline" onClick={() => focusChat()}>
            <MessageSquare size={15} /> Ask the assistant
          </button>
          <button type="button" className="flex cursor-pointer items-center gap-2 text-info hover:underline" onClick={openSettings}>
            <SettingsIcon size={15} /> Models and settings
          </button>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui-sm">
          {shortcuts.map(([k, v]) => (
            <div key={k} className="contents">
              <span className="text-right font-mono text-muted">{k}</span>
              <span className="text-fg">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function EditorArea() {
  const tabs = useApp((s) => s.tabs)
  const activeTabId = useApp((s) => s.activeTabId)
  const runId = useApp((s) => s.runId)
  const active = tabs.find((t) => t.id === activeTabId) ?? null
  const { runPath, focusChat } = useApp.getState()

  return (
    <div className="flex h-full min-w-0 flex-col bg-editor">
      {tabs.length > 0 && (
        <div className="flex h-[35px] shrink-0 items-stretch bg-tabbar">
          <div role="tablist" className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-[3px]">
            {tabs.map((t) => (
              <TabItem key={t.id} tab={t} active={t.id === activeTabId} />
            ))}
          </div>
          {active?.kind === 'file' && (
            <div className="flex items-center gap-0.5 px-2">
              <IconButton icon={Sparkles} label="Ask AI about this file" onClick={() => focusChat()} />
              {RUNNABLE.test(active.path) && <IconButton icon={Play} label="Run File (F5)" disabled={!!runId} onClick={() => void runPath(active.path)} />}
            </div>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {!active && <Welcome />}
        {active?.kind === 'file' && <FileEditor tab={active} />}
        {active?.kind === 'diff' && <DiffView key={active.id} tab={active} />}
        {active?.kind === 'settings' && <SettingsView />}
      </div>
    </div>
  )
}
