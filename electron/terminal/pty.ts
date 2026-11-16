import os from 'node:os'
import type { IPty } from '@lydell/node-pty'
import { newId } from '../util/id'

type PtyModule = typeof import('@lydell/node-pty')
let ptyModule: PtyModule | null = null
let loadError: string | null = null

async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule || loadError) return ptyModule
  try {
    ptyModule = await import('@lydell/node-pty')
  } catch (e) {
    loadError = (e as Error).message
  }
  return ptyModule
}

export function defaultShell(preferred?: string): { file: string; args: string[] } {
  if (preferred && preferred.trim()) return { file: preferred.trim(), args: [] }
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] }
  return { file: process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: ['-l'] }
}

/** Interactive PTY terminals (user-driven shells). AI commands never go through here. */
export class TerminalManager {
  private terms = new Map<string, IPty>()

  constructor(
    private onData: (id: string, data: string) => void,
    private onExit: (id: string, code: number) => void
  ) {}

  async create(cols: number, rows: number, cwd: string | null, preferredShell?: string): Promise<{ id: string; shell: string } | { error: string }> {
    const pty = await loadPty()
    if (!pty) return { error: `Interactive terminal unavailable: ${loadError ?? 'node-pty failed to load'}` }
    const { file, args } = defaultShell(preferredShell)
    const id = newId('term_')
    try {
      const term = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: Math.max(2, cols | 0),
        rows: Math.max(2, rows | 0),
        cwd: cwd ?? os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
      })
      term.onData((d) => this.onData(id, d))
      term.onExit(({ exitCode }) => {
        this.terms.delete(id)
        this.onExit(id, exitCode)
      })
      this.terms.set(id, term)
      return { id, shell: file }
    } catch (e) {
      return { error: `Could not start ${file}: ${(e as Error).message}` }
    }
  }

  write(id: string, data: string): void {
    this.terms.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.terms.get(id)?.resize(Math.max(2, cols | 0), Math.max(2, rows | 0))
    } catch {
      /* terminal already gone */
    }
  }

  kill(id: string): void {
    const t = this.terms.get(id)
    if (t) {
      try {
        t.kill()
      } catch {
        /* ignore */
      }
      this.terms.delete(id)
    }
  }

  killAll(): void {
    for (const id of [...this.terms.keys()]) this.kill(id)
  }
}
