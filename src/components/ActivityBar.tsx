import { BookOpen, Files, Play, Search, Settings, type LucideIcon } from 'lucide-react'
import { useApp, type SideView } from '@/store/app'

function ActivityItem({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`relative flex h-[48px] w-[48px] cursor-pointer items-center justify-center ${active ? 'text-activity-active' : 'text-activity-fg hover:text-activity-active'}`}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-activity-active" />}
      <Icon size={24} strokeWidth={1.5} />
    </button>
  )
}

export function ActivityBar() {
  const view = useApp((s) => s.view)
  const sidebarVisible = useApp((s) => s.sidebarVisible)
  const settingsOpen = useApp((s) => s.activeTabId === 'settings')
  const { setView, openSettings } = useApp.getState()
  const items: Array<{ id: SideView; icon: LucideIcon; label: string }> = [
    { id: 'explorer', icon: Files, label: 'Explorer (Ctrl+Shift+E)' },
    { id: 'search', icon: Search, label: 'Search (Ctrl+Shift+F)' },
    { id: 'run', icon: Play, label: 'Run and Debug (F5 runs the active file)' },
    { id: 'knowledge', icon: BookOpen, label: 'Knowledge library: syllabus, notes, references' }
  ]
  return (
    <nav className="flex w-[48px] shrink-0 flex-col items-center border-r border-line bg-activity" aria-label="Activity bar">
      {items.map((it) => (
        <ActivityItem key={it.id} icon={it.icon} label={it.label} active={sidebarVisible && view === it.id} onClick={() => setView(it.id)} />
      ))}
      <div className="flex-1" />
      <ActivityItem icon={Settings} label="Settings (Ctrl+,)" active={settingsOpen} onClick={openSettings} />
    </nav>
  )
}
