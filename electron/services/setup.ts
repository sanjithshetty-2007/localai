import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SetupProgress, SetupStatus } from '../../shared/types'
import { MODEL_SIZES_GB, PROFILE_PRESETS } from '../../shared/profiles'
import { getSettings } from './db'
import { detectHardware } from './hardware'
import { OllamaClient, findOllamaBinary, startOllamaServer } from './ollama'

/*
 * First-run setup: installs Ollama and downloads the models for the chosen hardware
 * profile, so a fresh computer only needs the app installer.
 */

const OLLAMA_WINDOWS_URL = 'https://ollama.com/download/OllamaSetup.exe'
const OLLAMA_MAC_URL = 'https://ollama.com/download/Ollama-darwin.zip'
const STALL_MS = 60_000

function run(cmd: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` }))
    } catch {
      resolve({ ok: false, out: '' })
    }
  })
}

export class SetupManager {
  private abort: AbortController | null = null

  constructor(
    private ollama: OllamaClient,
    private emit: (p: SetupProgress) => void
  ) {}

  cancel(): void {
    this.abort?.abort()
  }

  async status(): Promise<SetupStatus> {
    const settings = getSettings()
    this.ollama.setBaseUrl(settings.ollamaUrl)
    const hardware = await detectHardware().catch(() => null)
    let running = false
    let version: string | undefined
    let installed: string[] = []
    try {
      version = await this.ollama.version()
      running = true
      installed = (await this.ollama.tags()).map((m) => m.name)
    } catch {
      /* not running */
    }
    const has = (n: string) => installed.includes(n) || installed.includes(`${n}:latest`)
    const profile = settings.profile
    const roles = settings.roles
    const required = [...new Set(Object.values(roles))].map((name) => ({ name, sizeGB: MODEL_SIZES_GB[name] ?? null, installed: has(name) }))
    return {
      platform: process.platform,
      ollamaPath: findOllamaBinary(),
      ollamaRunning: running,
      ollamaVersion: version,
      profile,
      recommendedProfile: hardware?.recommendedProfile ?? profile,
      hardwareSummary: hardware
        ? `${hardware.gpus.map((g) => g.name + (g.vramGB ? ` (${g.vramGB} GB)` : '')).join(', ') || 'No GPU detected'} · ${hardware.totalRamGB} GB RAM`
        : 'Unknown hardware',
      required,
      presets: Object.fromEntries(
        Object.entries(PROFILE_PRESETS).map(([k, p]) => [k, { label: p.label, totalGB: [...new Set(Object.values(p.roles))].reduce((n, m) => n + (MODEL_SIZES_GB[m] ?? 0), 0) }])
      ) as SetupStatus['presets']
    }
  }

  /** Install Ollama. Windows: winget, falling back to the signed official installer. Other OSes: guided. */
  async installOllama(): Promise<{ ok: boolean; message: string }> {
    if (findOllamaBinary()) return this.ensureRunning()
    if (process.platform === 'darwin') return this.installOllamaMac()
    if (process.platform !== 'win32') {
      return { ok: false, message: 'Run this in a terminal, then click "Check again":  curl -fsSL https://ollama.com/install.sh | sh' }
    }
    this.abort = new AbortController()
    const step = 'ollama'
    // 1) winget (built into Windows 10/11)
    const winget = await run('winget', ['--version'])
    if (winget.ok) {
      this.emit({ step, status: 'Installing Ollama with winget…' })
      const ok = await new Promise<boolean>((resolve) => {
        const child = spawn('winget', ['install', '--id', 'Ollama.Ollama', '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements'], { windowsHide: true })
        const onData = (d: Buffer) => {
          const line = d.toString('utf8').split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !/^[-\\|/]$/.test(l)).pop()
          if (line) this.emit({ step, status: line.slice(0, 120) })
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        this.abort!.signal.addEventListener('abort', () => child.kill())
        child.on('error', () => resolve(false))
        child.on('close', (code) => resolve(code === 0 || !!findOllamaBinary()))
      })
      if (ok && findOllamaBinary()) return this.ensureRunning()
    }
    // 2) Official installer from ollama.com, verified by its Authenticode signature before running.
    const file = path.join(os.tmpdir(), 'OllamaSetup.exe')
    try {
      await this.download(OLLAMA_WINDOWS_URL, file, step, 'Downloading Ollama')
    } catch (e) {
      return { ok: false, message: `Could not download Ollama: ${(e as Error).message}. Install it from https://ollama.com/download and click "Check again".` }
    }
    this.emit({ step, status: 'Verifying the installer signature…' })
    const sig = await run('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`])
    const [sigStatus, subject = ''] = sig.out.trim().split('|')
    if (sigStatus !== 'Valid' || !/ollama/i.test(subject)) {
      await fsp.rm(file, { force: true })
      return { ok: false, message: `The downloaded installer is not signed by Ollama (${sigStatus || 'unknown'}). It was deleted. Install from https://ollama.com/download instead.` }
    }
    this.emit({ step, status: 'Running the Ollama installer…' })
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(file, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { windowsHide: true })
      child.on('error', () => resolve(null))
      child.on('close', resolve)
    })
    await fsp.rm(file, { force: true }).catch(() => undefined)
    if (code !== 0 && !findOllamaBinary()) return { ok: false, message: `The Ollama installer exited with code ${code}. Install it from https://ollama.com/download.` }
    return this.ensureRunning()
  }

  /**
   * macOS: download the official Ollama.app, verify Apple's code signature (Developer ID,
   * Ollama team), install it to /Applications (or ~/Applications without admin rights) and start it.
   */
  private async installOllamaMac(): Promise<{ ok: boolean; message: string }> {
    const step = 'ollama'
    const manual = 'Install Ollama from https://ollama.com/download (open the .dmg and drag Ollama to Applications), start it once, then click "Check again".'
    this.abort = new AbortController()
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ollama-mac-'))
    try {
      const zip = path.join(work, 'Ollama-darwin.zip')
      try {
        await this.download(OLLAMA_MAC_URL, zip, step, 'Downloading Ollama for macOS')
      } catch (e) {
        return { ok: false, message: `Could not download Ollama: ${(e as Error).message}. ${manual}` }
      }
      this.emit({ step, status: 'Unpacking…' })
      const unzip = await run('/usr/bin/ditto', ['-x', '-k', zip, work], 120000)
      const appPath = path.join(work, 'Ollama.app')
      if (!unzip.ok || !fs.existsSync(appPath)) return { ok: false, message: `Could not unpack Ollama. ${manual}` }

      this.emit({ step, status: 'Verifying Apple code signature…' })
      const verify = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], 120000)
      const info = await run('/usr/bin/codesign', ['-dv', '--verbose=2', appPath], 30000)
      if (!verify.ok || !/Authority=Developer ID Application:.*Ollama/i.test(info.out)) {
        return { ok: false, message: `The downloaded Ollama app is not signed by Ollama, so it was not installed. ${manual}` }
      }

      this.emit({ step, status: 'Installing to Applications…' })
      let target = '/Applications/Ollama.app'
      let moved = await run('/usr/bin/ditto', [appPath, target], 120000)
      if (!moved.ok) {
        // No write access to /Applications (standard user): use ~/Applications.
        const userApps = path.join(os.homedir(), 'Applications')
        await fsp.mkdir(userApps, { recursive: true })
        target = path.join(userApps, 'Ollama.app')
        moved = await run('/usr/bin/ditto', [appPath, target], 120000)
        if (!moved.ok) return { ok: false, message: `Could not copy Ollama into Applications. ${manual}` }
      }
      this.emit({ step, status: 'Starting Ollama…' })
      await run('/usr/bin/open', ['-a', target])
      return this.ensureRunning()
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async ensureRunning(): Promise<{ ok: boolean; message: string }> {
    const step = 'ollama'
    for (let i = 0; i < 40; i++) {
      try {
        const v = await this.ollama.version()
        this.emit({ step, status: `Ollama ${v} is running`, done: true })
        return { ok: true, message: `Ollama ${v} is running` }
      } catch {
        if (i === 2) startOllamaServer()
        this.emit({ step, status: 'Starting Ollama…' })
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    return { ok: false, message: 'Ollama is installed but did not start. Open "Ollama" from the Start menu, then click "Check again".' }
  }

  private async download(url: string, file: string, step: string, label: string): Promise<void> {
    const res = await fetch(url, { signal: this.abort?.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || undefined
    const out = fs.createWriteStream(file)
    const reader = res.body.getReader()
    let completed = 0
    let last = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      completed += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      if (Date.now() - last > 500) {
        last = Date.now()
        this.emit({ step, status: label, completed, total })
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  }

  /** Download models one after another, resuming automatically when a download stalls. */
  async pullModels(models: string[]): Promise<{ ok: boolean; failed: string[] }> {
    this.abort = new AbortController()
    const failed: string[] = []
    for (const model of models) {
      let success = false
      for (let attempt = 1; attempt <= 15 && !this.abort.signal.aborted; attempt++) {
        const ctrl = new AbortController()
        const onAbort = () => ctrl.abort()
        this.abort.signal.addEventListener('abort', onAbort)
        let lastProgress = Date.now()
        let lastCompleted = -1
        const watchdog = setInterval(() => Date.now() - lastProgress > STALL_MS && ctrl.abort(), 5000)
        try {
          await this.ollama.pull(
            model,
            (p) => {
              if ((p.completed ?? 0) !== lastCompleted) {
                lastCompleted = p.completed ?? 0
                lastProgress = Date.now()
              }
              this.emit({ step: model, status: p.status, completed: p.completed, total: p.total })
            },
            ctrl.signal
          )
          success = true
          this.emit({ step: model, status: 'installed', done: true })
          break
        } catch (e) {
          if (this.abort.signal.aborted) break
          this.emit({ step: model, status: `${ctrl.signal.aborted ? 'download stalled' : (e as Error).message} — retrying (${attempt})` })
          await new Promise((r) => setTimeout(r, 3000))
        } finally {
          clearInterval(watchdog)
          this.abort.signal.removeEventListener('abort', onAbort)
        }
      }
      if (!success) {
        failed.push(model)
        this.emit({ step: model, status: this.abort.signal.aborted ? 'cancelled' : 'failed', done: true, error: 'not installed' })
        if (this.abort.signal.aborted) break
      }
    }
    return { ok: failed.length === 0, failed }
  }
}
