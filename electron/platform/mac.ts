import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { Menu, app, type BrowserWindow } from 'electron'

/*
 * macOS-only adjustments. Every function here is a no-op on Windows and Linux unless
 * stated, so the Windows build behaves exactly as before.
 */

/**
 * Apps started from Finder/Dock get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so
 * Homebrew tools (python3, node, g++, ollama) would be invisible. Merge the user's login
 * shell PATH and the usual install locations. Runs on macOS and Linux only.
 */
export function fixUnixPath(): void {
  if (process.platform === 'win32') return
  const parts = new Set((process.env.PATH ?? '').split(':').filter(Boolean))
  try {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    const out = execFileSync(shell, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })
    const m = /__PATH__(.*?)__PATH__/.exec(out)
    if (m) for (const p of m[1].split(':')) if (p) parts.add(p)
  } catch {
    /* shell unavailable or slow: fall back to the common locations below */
  }
  const home = os.homedir()
  for (const p of ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin', path.join(home, '.local', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin']) parts.add(p)
  process.env.PATH = [...parts].join(':')
}

/**
 * A standard macOS application menu. Without one, Cmd+C/V/X/A/Z do not work in text
 * fields, and Electron's default "Close Window" (Cmd+W) would close the whole window
 * instead of the editor tab. Cmd+W and Cmd+, are left to the app's own shortcuts.
 */
export function installMacMenu(getWindow: () => BrowserWindow | null): void {
  if (process.platform !== 'darwin') return
  const send = (js: string) => getWindow()?.webContents.executeJavaScript(js).catch(() => undefined)
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', click: () => void send('window.__localcode?.getState().openSettings()') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', click: () => void send('window.__localcode?.getState().openFolder()') },
        { label: 'Save', click: () => void send('window.__localcode?.getState().saveFile()') },
        { type: 'separator' },
        { label: 'Close Editor Tab', click: () => void send('(s => s.activeTabId && s.closeTab(s.activeTabId))(window.__localcode.getState())') },
        { label: 'Close Window', accelerator: 'Cmd+Shift+W', role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Hide / Show AI Assistant', click: () => void send('(s => s.updateSettings({ aiSidebarVisible: !s.settings?.aiSidebarVisible }))(window.__localcode.getState())') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ])
  Menu.setApplicationMenu(menu)
}
