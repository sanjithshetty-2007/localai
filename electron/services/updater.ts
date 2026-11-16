import { app, shell } from 'electron'
import type { UpdateState } from '../../shared/types'
import { newerVersion } from '../../shared/version'

/*
 * Updates from GitHub Releases.
 * - Windows (NSIS) and Linux AppImage: electron-updater downloads in the background and
 *   installs when the app quits (or immediately via "Restart to update").
 * - macOS: Squirrel.Mac only accepts updates for apps signed with a paid Apple Developer ID,
 *   which this build does not have, so the app checks GitHub and offers the new .dmg instead.
 * Only github.com is contacted, and only when automatic updates are enabled or the user checks.
 */

export const UPDATE_REPO = { owner: 'sanjithshetty-2007', repo: 'localai' }
const RELEASES_URL = `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`

type AutoUpdater = typeof import('electron-updater').autoUpdater

export class Updater {
  private state: UpdateState = { status: 'idle', currentVersion: app.getVersion() }
  private auto: AutoUpdater | null = null
  private timer: NodeJS.Timeout | null = null
  private macDownloadUrl: string | null = null

  constructor(private emit: (s: UpdateState) => void) {}

  getState(): UpdateState {
    return { ...this.state }
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.emit(this.getState())
  }

  /** Whether this build can install updates by itself (Windows installer / Linux AppImage). */
  private canSelfUpdate(): boolean {
    return app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE))
  }

  private async loadAuto(): Promise<AutoUpdater | null> {
    if (this.auto || !this.canSelfUpdate()) return this.auto
    // electron-updater is CommonJS with a lazy getter, so the named export can be missing on import().
    const mod = (await import('electron-updater')) as unknown as { autoUpdater?: AutoUpdater; default?: { autoUpdater: AutoUpdater } }
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
    if (!autoUpdater) throw new Error('Updater module could not be loaded')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', latestVersion: info.version, percent: 0 }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'latest', checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', latestVersion: info.version, percent: 100, checkedAt: Date.now() }))
    autoUpdater.on('error', (e) => this.set({ status: 'error', error: friendly(e), checkedAt: Date.now() }))
    this.auto = autoUpdater
    return autoUpdater
  }

  /** Start periodic checks (first after a short delay). No-op in development builds. */
  start(enabled: boolean): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!enabled || !app.isPackaged) {
      if (!app.isPackaged) this.set({ status: 'unsupported', error: 'Updates are checked in installed builds only.' })
      return
    }
    setTimeout(() => void this.check(), 20_000)
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000)
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) {
      this.set({ status: 'unsupported', error: 'Updates are checked in installed builds only.' })
      return this.getState()
    }
    if (this.state.status === 'downloading' || this.state.status === 'ready') return this.getState()
    try {
      const auto = await this.loadAuto()
      if (auto) {
        await auto.checkForUpdates()
        return this.getState()
      }
      // macOS (and Linux without AppImage): ask GitHub for the latest release and offer it.
      this.set({ status: 'checking', error: undefined })
      const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LocalCode-AI-Studio-updater' },
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`)
      const rel = (await res.json()) as { tag_name: string; html_url: string; assets: Array<{ name: string; browser_download_url: string }> }
      const latest = rel.tag_name.replace(/^v/, '')
      if (!newerVersion(latest, app.getVersion())) {
        this.set({ status: 'latest', latestVersion: latest, checkedAt: Date.now() })
      } else {
        const want = process.platform === 'darwin' ? (process.arch === 'arm64' ? /-mac-arm64\.dmg$/ : /-mac-x64\.dmg$/) : /\.AppImage$/
        this.macDownloadUrl = rel.assets.find((a) => want.test(a.name))?.browser_download_url ?? rel.html_url
        this.set({ status: 'available', latestVersion: latest, checkedAt: Date.now() })
      }
    } catch (e) {
      this.set({ status: 'error', error: friendly(e), checkedAt: Date.now() })
    }
    return this.getState()
  }

  /** Windows/Linux: restart into the downloaded update. macOS: open the new .dmg download. */
  async install(): Promise<void> {
    if (this.state.status === 'ready' && this.auto) {
      setImmediate(() => this.auto!.quitAndInstall(true, true))
      return
    }
    if (this.state.status === 'available') await shell.openExternal(this.macDownloadUrl ?? RELEASES_URL)
  }
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|fetch failed|timeout/i.test(msg)) return 'No internet connection (updates will be checked later).'
  return msg.split('\n')[0].slice(0, 200)
}
