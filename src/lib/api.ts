import type { LocalCodeApi } from '@shared/api'

declare global {
  interface Window {
    api: LocalCodeApi
  }
}

export const api: LocalCodeApi = window.api

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Strip Electron's IPC wrapper text.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

export function dirname(p: string): string {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join(p.includes('\\') ? '\\' : '/')
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}

export function relativePath(root: string | null, p: string): string {
  if (!root) return p
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root)
  const f = norm(p)
  return f.toLowerCase().startsWith(r.toLowerCase() + '/') ? f.slice(r.length + 1) : f
}

export function samePath(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\\/g, '/').toLowerCase()
  return n(a) === n(b)
}

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', java: 'java', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', c: 'c', h: 'cpp', cs: 'csharp', go: 'go', rs: 'rust',
  rb: 'ruby', php: 'php', json: 'json', md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', css: 'css', scss: 'scss',
  less: 'less', xml: 'xml', svg: 'xml', yml: 'yaml', yaml: 'yaml', sql: 'sql', sh: 'shell', bash: 'shell', ps1: 'powershell',
  bat: 'bat', ini: 'ini', toml: 'ini', kt: 'kotlin', swift: 'swift', dockerfile: 'dockerfile', txt: 'plaintext'
}

export function languageFor(p: string): string {
  const name = basename(p).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return LANG[ext] ?? 'plaintext'
}

export const RUNNABLE = /\.(py|js|mjs|cjs|ts|mts|cpp|cc|cxx|c|java)$/i

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g, '')
}
