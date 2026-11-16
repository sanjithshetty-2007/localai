import { app, BrowserWindow, shell, session } from 'electron'
import path from 'node:path'
import { registerIpc, shutdownServices, TITLEBAR_COLORS } from './ipc/register'
import { getSettings } from './services/db'

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']

// Lets automated tests run against an isolated profile (database, settings).
if (process.env.LOCALCODE_USER_DATA) app.setPath('userData', process.env.LOCALCODE_USER_DATA)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const settings = getSettings()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'LocalCode AI Studio',
    backgroundColor: settings.theme === 'dark' ? '#1e1e1e' : '#ffffff',
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { ...TITLEBAR_COLORS[settings.theme], height: 34 } } : {}),
    trafficLightPosition: { x: 12, y: 10 },
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Never open new Electron windows; send http(s) links to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(process.env['ELECTRON_RENDERER_URL']!) : url.startsWith('file://')
    if (!allowed) e.preventDefault()
  })

  if (isDev) void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    // Deny every permission request (camera, geolocation, notifications...) — none are needed.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'))
    registerIpc(getMainWindow)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    shutdownServices()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => shutdownServices())
}
