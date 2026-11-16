import { Bot, Cpu, FolderOpen, Moon, PanelRight, Sun } from 'lucide-react'
import type { HardwareProfile } from '@shared/types'
import { PROFILE_PRESETS } from '@shared/profiles'
import { useApp } from '@/store/app'
import { basename } from '@/lib/api'
import { IconButton } from './ui'

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--vs-accent)" />
      <path d="M8.5 8 5 12l3.5 4M15.5 8 19 12l-3.5 4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.6" fill="#fff" />
    </svg>
  )
}

export function TitleBar() {
  const workspace = useApp((s) => s.workspace)
  const settings = useApp((s) => s.settings)
  const ollama = useApp((s) => s.ollama)
  const platform = useApp((s) => s.platform)
  const { openFolder, toggleTheme, updateSettings, openSettings } = useApp.getState()
  if (!settings) return null

  const connected = ollama?.connected
  const running = ollama?.running[0]?.name
  const isMac = platform === 'darwin'

  const applyProfile = (p: HardwareProfile) => {
    const preset = PROFILE_PRESETS[p]
    void updateSettings({ profile: p, numCtx: preset.numCtx, temperature: preset.temperature, roles: preset.roles })
  }

  return (
    <div
      className="drag flex h-[34px] shrink-0 items-center gap-2 border-b border-line bg-titlebar text-titlebar-fg"
      style={{ paddingLeft: isMac ? 78 : 10, paddingRight: isMac ? 10 : 144 }}
    >
      <Logo />
      <span className="text-ui-sm font-semibold whitespace-nowrap">LocalCode AI Studio</span>
      <span className="mx-1 h-4 border-l border-line-strong" />
      <button
        type="button"
        className="no-drag flex h-[22px] max-w-[260px] cursor-pointer items-center gap-1.5 rounded-[4px] px-2 text-ui-sm hover:bg-hover"
        title={workspace ?? 'Open a folder'}
        onClick={() => void openFolder()}
      >
        <FolderOpen size={14} strokeWidth={1.6} />
        <span className="truncate">{workspace ? basename(workspace) : 'Open Folder…'}</span>
      </button>

      <div className="flex-1" />

      <label className="no-drag flex items-center gap-1 text-ui-xs" title="Hardware profile">
        <Cpu size={13} strokeWidth={1.6} className="text-muted" />
        <select
          className="h-[22px] cursor-pointer rounded-[2px] border border-transparent bg-transparent px-1 text-ui-xs outline-none hover:border-line-strong"
          value={settings.profile}
          onChange={(e) => applyProfile(e.target.value as HardwareProfile)}
        >
          {(Object.keys(PROFILE_PRESETS) as HardwareProfile[]).map((p) => (
            <option key={p} value={p}>
              {PROFILE_PRESETS[p].label} mode
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="no-drag flex h-[22px] cursor-pointer items-center gap-1.5 rounded-[4px] px-2 text-ui-xs hover:bg-hover"
        title={connected ? `Ollama ${ollama?.version} at ${ollama?.url}` : `Ollama not reachable: ${ollama?.error ?? 'checking…'}`}
        onClick={openSettings}
      >
        <span className={`h-[8px] w-[8px] rounded-full ${ollama == null ? 'bg-muted' : connected ? 'bg-success' : 'bg-error'}`} />
        {ollama == null ? 'Ollama…' : connected ? 'Ollama' : 'Ollama offline'}
      </button>

      <span className="no-drag flex items-center gap-1 text-ui-xs text-titlebar-fg" title="Model currently loaded in Ollama memory (coder model when idle)">
        <Bot size={13} strokeWidth={1.6} className="text-muted" />
        <span className="max-w-[160px] truncate">{running ?? settings.roles.coder}</span>
      </span>

      <IconButton icon={settings.theme === 'dark' ? Sun : Moon} label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme} />
      <IconButton
        icon={PanelRight}
        label="Hide / show AI assistant (Ctrl+Shift)"
        active={settings.aiSidebarVisible}
        onClick={() => void updateSettings({ aiSidebarVisible: !settings.aiSidebarVisible })}
      />
    </div>
  )
}
