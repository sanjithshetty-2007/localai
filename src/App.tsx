import { useEffect } from 'react'
import { useApp } from '@/store/app'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Explorer } from '@/components/Explorer/Explorer'
import { SearchView } from '@/components/Search/SearchView'
import { RunView } from '@/components/Run/RunView'
import { KnowledgeView } from '@/components/Knowledge/KnowledgeView'
import { EditorArea } from '@/components/Editor/EditorArea'
import { BottomPanel } from '@/components/Terminal/BottomPanel'
import { AISidebar } from '@/components/AISidebar/AISidebar'
import { StatusBar } from '@/components/StatusBar'
import { Dialogs } from '@/components/Dialogs'
import { SetupWizard } from '@/components/Setup/SetupWizard'
import { PaneBoundary, Resizer, Spinner } from '@/components/ui'

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && !e.shiftKey && k === 's') {
        e.preventDefault()
        void s.saveFile()
      } else if (mod && e.shiftKey && k === 's') {
        e.preventDefault()
        void s.saveAs()
      } else if (mod && !e.shiftKey && k === 'o') {
        e.preventDefault()
        void s.openFolder()
      } else if (mod && !e.shiftKey && k === 'b') {
        e.preventDefault()
        useApp.setState((st) => ({ sidebarVisible: !st.sidebarVisible }))
      } else if (mod && !e.shiftKey && k === 'j') {
        e.preventDefault()
        s.togglePanel()
      } else if (mod && e.key === '`') {
        e.preventDefault()
        s.togglePanel('terminal')
      } else if (mod && e.shiftKey && k === 'a') {
        e.preventDefault()
        void s.updateSettings({ aiSidebarVisible: !s.settings?.aiSidebarVisible })
      } else if (mod && !e.shiftKey && k === 'l') {
        e.preventDefault()
        s.focusChat()
      } else if (mod && e.shiftKey && k === 'f') {
        e.preventDefault()
        useApp.setState({ view: 'search', sidebarVisible: true })
      } else if (mod && e.shiftKey && k === 'e') {
        e.preventDefault()
        useApp.setState({ view: 'explorer', sidebarVisible: true })
      } else if (mod && e.key === ',') {
        e.preventDefault()
        s.openSettings()
      } else if (mod && !e.shiftKey && k === 'w') {
        e.preventDefault()
        if (s.activeTabId) void s.closeTab(s.activeTabId)
      } else if (e.key === 'F5' && !mod) {
        e.preventDefault()
        void s.runActiveFile()
      } else if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault()
        void s.stopRun()
      }
    }
    window.addEventListener('keydown', onKey)

    // Ctrl+Shift pressed and released on its own (no other key in between) hides/shows the assistant.
    let ctrl = false
    let shift = false
    let chord = false // both were held together
    let dirty = false // another key or a click happened during the chord
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrl = true
      else if (e.key === 'Shift') shift = true
      else dirty = true
      if (ctrl && shift) chord = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrl = false
      if (e.key === 'Shift') shift = false
      if (!ctrl && !shift) {
        if (chord && !dirty) {
          const s = useApp.getState()
          void s.updateSettings({ aiSidebarVisible: !s.settings?.aiSidebarVisible })
        }
        chord = false
        dirty = false
      }
    }
    const reset = () => {
      dirty = true
    }
    const clear = () => {
      ctrl = shift = chord = dirty = false
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('mousedown', reset, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('mousedown', reset, true)
      window.removeEventListener('blur', clear)
    }
  }, [])
}

export default function App() {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const sidebarVisible = useApp((s) => s.sidebarVisible)
  const sidebarWidth = useApp((s) => s.sidebarWidth)
  const panelVisible = useApp((s) => s.panelVisible)
  const panelHeight = useApp((s) => s.panelHeight)
  const aiVisible = useApp((s) => s.settings?.aiSidebarVisible ?? true)
  const aiWidth = useApp((s) => s.settings?.aiSidebarWidth ?? 400)
  useGlobalShortcuts()

  useEffect(() => {
    void useApp.getState().init()
    const warnUnsaved = (e: BeforeUnloadEvent) => {
      if (useApp.getState().tabs.some((t) => t.kind === 'file' && t.content !== t.saved)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warnUnsaved)
    return () => window.removeEventListener('beforeunload', warnUnsaved)
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-editor text-ui text-muted">
        <Spinner /> Starting LocalCode AI Studio…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {sidebarVisible && (
          <>
            <div className="shrink-0 overflow-hidden border-r border-line bg-sidebar" style={{ width: sidebarWidth }}>
              <PaneBoundary name="sidebar">
                {view === 'explorer' && <Explorer />}
                {view === 'search' && <SearchView />}
                {view === 'run' && <RunView />}
                {view === 'knowledge' && <KnowledgeView />}
              </PaneBoundary>
            </div>
            <Resizer direction="horizontal" onResize={(d) => useApp.setState((s) => ({ sidebarWidth: Math.max(170, Math.min(600, s.sidebarWidth + d)) }))} />
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <PaneBoundary name="editor">
              <EditorArea />
            </PaneBoundary>
          </div>
          {panelVisible && (
            <>
              <Resizer direction="vertical" onResize={(d) => useApp.setState((s) => ({ panelHeight: Math.max(100, Math.min(window.innerHeight - 200, s.panelHeight - d)) }))} />
              <div className="shrink-0" style={{ height: panelHeight }}>
                <PaneBoundary name="panel">
                  <BottomPanel />
                </PaneBoundary>
              </div>
            </>
          )}
        </div>
        {/* The assistant stays mounted when hidden so it keeps working in the background. */}
        <div className={aiVisible ? 'contents' : 'hidden'} aria-hidden={!aiVisible}>
          <>
            <Resizer
              direction="horizontal"
              onResize={(d) => {
                const st = useApp.getState()
                if (!st.settings) return
                useApp.setState({ settings: { ...st.settings, aiSidebarWidth: Math.max(300, Math.min(800, st.settings.aiSidebarWidth - d)) } })
              }}
              onEnd={() => {
                const w = useApp.getState().settings?.aiSidebarWidth
                if (w) void useApp.getState().updateSettings({ aiSidebarWidth: w })
              }}
            />
            <div className="shrink-0 border-l border-line" style={{ width: aiWidth }}>
              <PaneBoundary name="assistant">
                <AISidebar />
              </PaneBoundary>
            </div>
          </>
        </div>
      </div>
      <StatusBar />
      <SetupWizard />
      <Dialogs />
    </div>
  )
}
