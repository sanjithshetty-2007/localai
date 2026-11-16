import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { RunEvent, RunProblem, RunResult, RuntimeInfo } from '../../shared/types'
import { newId } from '../util/id'
import { parseCommand, WINDOWS_CMD_SHIMS } from '../security/commands'
import { isMacPlaceholder } from '../platform/mac-tools'

const isWin = process.platform === 'win32'
const MAX_CAPTURE = 200_000

function probe(cmd: string, args: string[]): Promise<string | null> {
  // macOS: never execute install-prompt placeholders (/usr/bin/python3 etc. without Command Line Tools).
  if (isMacPlaceholder(cmd)) return Promise.resolve(null)
  return new Promise((resolve) => {
    // Batch shims (.cmd) cannot be spawned directly on Windows; go through cmd.exe.
    const viaCmd = isWin && /\.(cmd|bat)$/i.test(cmd)
    const file = viaCmd ? process.env.ComSpec || 'cmd.exe' : cmd
    const argv = viaCmd ? ['/d', '/s', '/c', [cmd, ...args].join(' ')] : args
    try {
      execFile(file, argv, { timeout: 6000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err) return resolve(null)
        resolve(((stdout || '') + (stderr || '')).trim().split(/\r?\n/)[0] ?? '')
      })
    } catch {
      resolve(null)
    }
  })
}

interface Resolved {
  python?: string
  node?: string
  nodeVersion?: number[]
  gpp?: string
  javac?: string
  java?: string
  tsx?: string
}

let cache: { at: number; value: Resolved; info: RuntimeInfo[] } | null = null

export async function detectRuntimes(force = false): Promise<{ resolved: Resolved; info: RuntimeInfo[] }> {
  if (cache && !force && Date.now() - cache.at < 60_000) return { resolved: cache.value, info: cache.info }
  const r: Resolved = {}
  const info: RuntimeInfo[] = []

  const pyCandidates = isWin ? ['python', 'py', 'python3'] : ['python3', 'python']
  let pyVer: string | null = null
  for (const c of pyCandidates) {
    const v = await probe(c, ['--version'])
    if (v && /Python \d/.test(v)) {
      r.python = c
      pyVer = v
      break
    }
  }
  info.push({
    language: 'python',
    label: 'Python',
    available: !!r.python,
    command: r.python,
    version: pyVer ?? undefined,
    installHint: isWin ? 'Install Python from python.org (tick "Add python.exe to PATH") or run: winget install Python.Python.3.12' : process.platform === 'darwin' ? 'brew install python' : 'sudo apt install python3'
  })

  const nodeV = await probe('node', ['--version'])
  if (nodeV && /^v\d/.test(nodeV)) {
    r.node = 'node'
    r.nodeVersion = nodeV.slice(1).split('.').map(Number)
  }
  info.push({
    language: 'javascript',
    label: 'JavaScript (Node.js)',
    available: true,
    command: r.node ?? 'built-in Electron runtime',
    version: nodeV ?? `Electron Node ${process.versions.node}`,
    installHint: 'Install Node.js LTS from nodejs.org for full npm support. Without it, the app runs JavaScript with its built-in runtime.'
  })

  const tsx = await probe(isWin ? 'tsx.cmd' : 'tsx', ['--version'])
  if (tsx) r.tsx = isWin ? 'tsx.cmd' : 'tsx'
  const stripTypes = !!r.nodeVersion && (r.nodeVersion[0] > 22 || (r.nodeVersion[0] === 22 && r.nodeVersion[1] >= 6))
  info.push({
    language: 'typescript',
    label: 'TypeScript',
    available: stripTypes || !!r.tsx,
    command: stripTypes ? 'node --experimental-strip-types' : r.tsx,
    version: stripTypes ? nodeV ?? undefined : tsx ?? undefined,
    installHint: 'Install Node.js 22.6 or newer (runs .ts directly), or run: npm install -g tsx'
  })

  const gpp = await probe('g++', ['--version'])
  if (gpp) r.gpp = 'g++'
  info.push({
    language: 'cpp',
    label: 'C / C++ (g++)',
    available: !!gpp,
    command: gpp ? 'g++' : undefined,
    version: gpp ?? undefined,
    installHint: isWin ? 'Install MSYS2 (msys2.org) then: pacman -S mingw-w64-ucrt-x86_64-gcc, and add its bin folder to PATH' : process.platform === 'darwin' ? 'xcode-select --install' : 'sudo apt install build-essential'
  })

  const javac = await probe('javac', ['-version'])
  const java = await probe('java', ['-version'])
  if (javac) r.javac = 'javac'
  if (java) r.java = 'java'
  info.push({
    language: 'java',
    label: 'Java (JDK)',
    available: !!(javac && java),
    command: javac ? 'javac + java' : undefined,
    version: javac ?? undefined,
    installHint: isWin ? 'Install a JDK, e.g.: winget install EclipseAdoptium.Temurin.21.JDK' : process.platform === 'darwin' ? 'brew install openjdk' : 'sudo apt install default-jdk'
  })

  cache = { at: Date.now(), value: r, info }
  return { resolved: r, info }
}

export function languageForFile(file: string): string | null {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.py') return 'python'
  if (['.js', '.mjs', '.cjs'].includes(ext)) return 'javascript'
  if (['.ts', '.mts', '.cts'].includes(ext)) return 'typescript'
  if (['.cpp', '.cc', '.cxx', '.c'].includes(ext)) return 'cpp'
  if (ext === '.java') return 'java'
  return null
}

export function parseProblems(output: string, language: string, file: string): RunProblem[] {
  const problems: RunProblem[] = []
  const add = (f: string, line: number, column: number | undefined, message: string, severity: 'error' | 'warning' = 'error') => {
    if (!Number.isFinite(line)) return
    if (problems.some((p) => p.file === f && p.line === line && p.message === message)) return
    problems.push({ file: f, line, column, message: message.trim(), severity })
  }
  const lines = output.split(/\r?\n/)
  if (language === 'python') {
    let lastLoc: { f: string; line: number } | null = null
    const userLocs: Array<{ f: string; line: number }> = []
    for (const l of lines) {
      const m = /File "(.+?)", line (\d+)/.exec(l)
      if (m) {
        lastLoc = { f: m[1], line: Number(m[2]) }
        if (path.resolve(m[1]) === path.resolve(file)) userLocs.push(lastLoc)
      }
    }
    const errLine = [...lines].reverse().find((l) => /^\w*(Error|Exception|Interrupt)\b.*/.test(l.trim()))
    const loc = userLocs.at(-1) ?? lastLoc
    if (loc && errLine) add(loc.f, loc.line, undefined, errLine)
  } else if (language === 'cpp') {
    for (const l of lines) {
      const m = /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.+)$/.exec(l)
      if (m) add(m[1], Number(m[2]), Number(m[3]), m[5], m[4] === 'warning' ? 'warning' : 'error')
    }
  } else if (language === 'java') {
    for (const l of lines) {
      const m = /^(.+?\.java):(\d+):\s*(error|warning):\s*(.+)$/.exec(l)
      if (m) add(m[1], Number(m[2]), undefined, m[4], m[3] === 'warning' ? 'warning' : 'error')
      const s = /at .+\((\w+\.java):(\d+)\)/.exec(l)
      if (s && problems.length === 0) {
        const msg = lines.find((x) => /Exception|Error/.test(x)) ?? 'Runtime exception'
        add(path.join(path.dirname(file), s[1]), Number(s[2]), undefined, msg)
      }
    }
  } else if (language === 'javascript' || language === 'typescript') {
    const base = path.basename(file)
    const errMsg = lines.find((l) => /^\w*(Error|Exception)\b:/.test(l.trim()))
    for (const l of lines) {
      const m = /(?:\(|^|\s)((?:file:\/\/\/?)?[^\s()]+?\.(?:m?[jt]s|cjs|cts)):(\d+)(?::(\d+))?/.exec(l)
      if (m) {
        const f = m[1].replace(/^file:\/\/\/?/, '')
        if (f.includes('node:internal') || !f.endsWith(base)) continue
        add(path.isAbsolute(f) ? f : file, Number(m[2]), m[3] ? Number(m[3]) : undefined, errMsg ?? l)
        break
      }
    }
  }
  return problems
}

interface ActiveRun {
  child: ChildProcess
  killed: boolean
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (isWin) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

export class CodeRunner {
  private runs = new Map<string, ActiveRun>()

  constructor(private emit: (e: RunEvent) => void) {}

  stop(runId: string): void {
    const r = this.runs.get(runId)
    if (r) {
      r.killed = true
      killTree(r.child)
    }
  }

  stopAll(): void {
    for (const id of this.runs.keys()) this.stop(id)
  }

  stdin(runId: string, text: string): void {
    const r = this.runs.get(runId)
    r?.child.stdin?.write(text)
  }

  /** Spawn one process (argv form, no shell) and stream its output. */
  private exec(
    runId: string,
    argv: string[],
    cwd: string,
    opts: { env?: NodeJS.ProcessEnv; stdin?: boolean; timeoutMs?: number } = {}
  ): Promise<{ code: number | null; stdout: string; stderr: string; killed: boolean; spawnError?: string }> {
    return new Promise((resolve) => {
      let [cmd, ...args] = argv
      const exe = cmd.replace(/\.(cmd|bat|exe)$/i, '').toLowerCase()
      if (isWin && (WINDOWS_CMD_SHIMS.has(exe) || /\.(cmd|bat)$/i.test(cmd))) {
        // Batch shims cannot be spawned directly; args were validated to contain no shell metacharacters.
        args = ['/d', '/s', '/c', [cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')]
        cmd = process.env.ComSpec || 'cmd.exe'
      }
      let child: ChildProcess
      try {
        child = spawn(cmd, args, {
          cwd,
          env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0', ...opts.env },
          windowsHide: true,
          detached: !isWin,
          stdio: [opts.stdin === false ? 'ignore' : 'pipe', 'pipe', 'pipe'],
          windowsVerbatimArguments: cmd.toLowerCase().endsWith('cmd.exe')
        })
      } catch (e) {
        return resolve({ code: null, stdout: '', stderr: '', killed: false, spawnError: (e as Error).message })
      }
      const active: ActiveRun = { child, killed: false }
      this.runs.set(runId, active)
      let stdout = ''
      let stderr = ''
      let timer: NodeJS.Timeout | null = null
      if (opts.timeoutMs) {
        timer = setTimeout(() => {
          this.emit({ type: 'data', runId, stream: 'system', text: `\nTimed out after ${opts.timeoutMs! / 1000}s — stopping.\n` })
          active.killed = true
          killTree(child)
        }, opts.timeoutMs)
      }
      child.stdout?.on('data', (d: Buffer) => {
        const t = d.toString('utf8')
        if (stdout.length < MAX_CAPTURE) stdout += t
        this.emit({ type: 'data', runId, stream: 'stdout', text: t })
      })
      child.stderr?.on('data', (d: Buffer) => {
        const t = d.toString('utf8')
        if (stderr.length < MAX_CAPTURE) stderr += t
        this.emit({ type: 'data', runId, stream: 'stderr', text: t })
      })
      child.on('error', (e) => {
        if (timer) clearTimeout(timer)
        this.runs.delete(runId)
        resolve({ code: null, stdout, stderr, killed: active.killed, spawnError: e.message })
      })
      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        this.runs.delete(runId)
        resolve({ code, stdout, stderr, killed: active.killed })
      })
    })
  }

  /** Run a source file. Returns the run id immediately; results arrive as run events. */
  async runFile(file: string): Promise<string> {
    const runId = newId('run_')
    const language = languageForFile(file)
    void this.runFileInner(runId, file, language)
    return runId
  }

  private async runFileInner(runId: string, file: string, language: string | null): Promise<void> {
    const started = Date.now()
    const cwd = path.dirname(file)
    const base = path.basename(file)
    const finish = (partial: Omit<RunResult, 'runId' | 'file' | 'language' | 'durationMs'>) => {
      const result: RunResult = { runId, file, language: language ?? 'unknown', durationMs: Date.now() - started, ...partial }
      this.emit({ type: 'exit', runId, result })
    }
    if (!language) {
      this.emit({ type: 'start', runId, command: base, file })
      return finish({ command: base, exitCode: null, stdout: '', stderr: `Don't know how to run ${base}. Supported: .py .js .ts .cpp .c .java`, status: 'missing-runtime', problems: [] })
    }
    const { resolved, info } = await detectRuntimes()
    const rt = info.find((i) => i.language === language)!
    const missing = (msg: string) => {
      this.emit({ type: 'start', runId, command: base, file })
      this.emit({ type: 'data', runId, stream: 'system', text: `${msg}\nHow to install: ${rt.installHint}\n` })
      finish({ command: base, exitCode: null, stdout: '', stderr: msg, status: 'missing-runtime', problems: [] })
    }

    let argv: string[]
    let env: NodeJS.ProcessEnv | undefined
    if (language === 'python') {
      if (!resolved.python) return missing('Python was not found on this computer.')
      argv = [resolved.python, '-u', file]
    } else if (language === 'javascript') {
      if (resolved.node) argv = ['node', file]
      else {
        argv = [process.execPath, file]
        env = { ELECTRON_RUN_AS_NODE: '1' }
      }
    } else if (language === 'typescript') {
      const v = resolved.nodeVersion
      if (v && (v[0] > 22 || (v[0] === 22 && v[1] >= 6))) argv = ['node', '--experimental-strip-types', '--disable-warning=ExperimentalWarning', file]
      else if (resolved.tsx) argv = [resolved.tsx, file]
      else return missing('No TypeScript runtime was found.')
    } else if (language === 'cpp') {
      if (!resolved.gpp) return missing('The g++ compiler was not found.')
      const outDir = path.join(os.tmpdir(), 'localcode-build')
      fs.mkdirSync(outDir, { recursive: true })
      const exe = path.join(outDir, base.replace(/\.\w+$/, '') + '-' + runId + (isWin ? '.exe' : ''))
      const isC = path.extname(file).toLowerCase() === '.c'
      const compile = isC ? ['gcc', file, '-o', exe] : ['g++', '-std=c++17', file, '-o', exe]
      const cmdText = compile.join(' ')
      this.emit({ type: 'start', runId, command: cmdText, file })
      this.emit({ type: 'data', runId, stream: 'system', text: `> ${cmdText}\n` })
      const c = await this.exec(runId, compile, cwd, { stdin: false, timeoutMs: 120_000 })
      if (c.code !== 0) {
        const out = c.stdout + c.stderr
        return finish({ command: cmdText, exitCode: c.code, stdout: c.stdout, stderr: c.stderr || c.spawnError || '', status: c.killed ? 'killed' : 'compile-error', problems: parseProblems(out, 'cpp', file) })
      }
      this.emit({ type: 'data', runId, stream: 'system', text: `> ${path.basename(exe)}\n` })
      const r = await this.exec(runId, [exe], cwd)
      fs.rm(exe, { force: true }, () => undefined)
      return finish({
        command: `${cmdText} && ${path.basename(exe)}`,
        exitCode: r.code,
        stdout: r.stdout,
        stderr: r.stderr || r.spawnError || '',
        status: r.killed ? 'killed' : r.code === 0 ? 'success' : 'error',
        problems: parseProblems(r.stderr, 'cpp', file)
      })
    } else {
      // java
      if (!resolved.javac || !resolved.java) return missing('A Java JDK (javac + java) was not found.')
      const outDir = path.join(os.tmpdir(), 'localcode-build', runId)
      fs.mkdirSync(outDir, { recursive: true })
      const compile = ['javac', '-d', outDir, file]
      const cmdText = `javac ${base}`
      this.emit({ type: 'start', runId, command: cmdText, file })
      this.emit({ type: 'data', runId, stream: 'system', text: `> ${cmdText}\n` })
      const c = await this.exec(runId, compile, cwd, { stdin: false, timeoutMs: 120_000 })
      if (c.code !== 0) {
        return finish({ command: cmdText, exitCode: c.code, stdout: c.stdout, stderr: c.stderr || c.spawnError || '', status: c.killed ? 'killed' : 'compile-error', problems: parseProblems(c.stdout + c.stderr, 'java', file) })
      }
      const src = fs.readFileSync(file, 'utf8')
      const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(src)?.[1]
      const cls = (pkg ? pkg + '.' : '') + base.replace(/\.java$/, '')
      this.emit({ type: 'data', runId, stream: 'system', text: `> java ${cls}\n` })
      const r = await this.exec(runId, ['java', '-cp', outDir, cls], cwd)
      fs.rm(outDir, { recursive: true, force: true }, () => undefined)
      return finish({
        command: `${cmdText} && java ${cls}`,
        exitCode: r.code,
        stdout: r.stdout,
        stderr: r.stderr || r.spawnError || '',
        status: r.killed ? 'killed' : r.code === 0 ? 'success' : 'error',
        problems: parseProblems(r.stderr, 'java', file)
      })
    }

    const cmdText = argv.map((a) => (a === file ? base : a === process.execPath ? 'node (built-in)' : a)).join(' ')
    this.emit({ type: 'start', runId, command: cmdText, file })
    this.emit({ type: 'data', runId, stream: 'system', text: `> ${cmdText}\n` })
    const r = await this.exec(runId, argv, cwd, { env })
    finish({
      command: cmdText,
      exitCode: r.code,
      stdout: r.stdout,
      stderr: r.stderr || r.spawnError || '',
      status: r.killed ? 'killed' : r.code === 0 ? 'success' : 'error',
      problems: parseProblems(r.stderr + '\n' + r.stdout, language, file)
    })
  }

  /** Run an AI-proposed command that the user approved. Validated against the allowlist. */
  async runCommand(command: string, cwd: string): Promise<{ runId: string; result: RunResult }> {
    const parsed = parseCommand(command)
    const runId = newId('run_')
    const started = Date.now()
    this.emit({ type: 'start', runId, command, file: cwd })
    this.emit({ type: 'data', runId, stream: 'system', text: `> ${command}\n` })
    const r = await this.exec(runId, parsed.argv, cwd, { stdin: false, timeoutMs: 10 * 60_000 })
    const result: RunResult = {
      runId,
      file: cwd,
      language: 'shell',
      command,
      exitCode: r.code,
      durationMs: Date.now() - started,
      stdout: r.stdout,
      stderr: r.stderr || (r.spawnError ? `Could not start "${parsed.argv[0]}": ${r.spawnError}` : ''),
      status: r.killed ? 'killed' : r.code === 0 ? 'success' : 'error',
      problems: []
    }
    this.emit({ type: 'exit', runId, result })
    return { runId, result }
  }
}
