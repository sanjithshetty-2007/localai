import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FileNode, IndexStatus, ProjectMemory } from '../../shared/types'
import { getDb } from './db'
import { walkFiles, isProbablyBinary } from '../filesystem/fs-service'
import { ftsQuery } from './documents'

const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES = 6000
const CHUNK_LINES = 60

const LANG_BY_EXT: Record<string, string> = {
  '.py': 'Python', '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript (React)',
  '.ts': 'TypeScript', '.tsx': 'TypeScript (React)', '.java': 'Java', '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++',
  '.c': 'C', '.h': 'C/C++ header', '.cs': 'C#', '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.json': 'JSON', '.md': 'Markdown', '.sql': 'SQL',
  '.kt': 'Kotlin', '.swift': 'Swift', '.sh': 'Shell', '.yml': 'YAML', '.yaml': 'YAML', '.toml': 'TOML'
}

export function languageOf(file: string): string | null {
  return LANG_BY_EXT[path.extname(file).toLowerCase()] ?? null
}

export class ProjectIndexer {
  private status: IndexStatus = { workspace: null, files: 0, chunks: 0, indexing: false, lastIndexed: null }
  private runToken = 0

  constructor(private emit: (s: IndexStatus) => void) {}

  getStatus(): IndexStatus {
    return { ...this.status }
  }

  setWorkspace(ws: string | null): void {
    this.runToken++
    if (!ws) {
      this.status = { workspace: null, files: 0, chunks: 0, indexing: false, lastIndexed: null }
      this.emit(this.getStatus())
      return
    }
    const d = getDb()
    const files = (d.prepare('SELECT COUNT(*) n FROM project_files WHERE workspace = ?').get(ws) as { n: number }).n
    const proj = d.prepare('SELECT last_indexed FROM projects WHERE workspace = ?').get(ws) as { last_indexed: number | null } | undefined
    this.status = { workspace: ws, files, chunks: 0, indexing: false, lastIndexed: proj?.last_indexed ?? null }
  }

  /** Incremental index: only files whose size or mtime changed are re-chunked. */
  async index(ws: string): Promise<IndexStatus> {
    const token = ++this.runToken
    const d = getDb()
    this.status = { ...this.status, workspace: ws, indexing: true }
    this.emit(this.getStatus())

    const known = new Map(
      (d.prepare('SELECT path, size, mtime FROM project_files WHERE workspace = ?').all(ws) as Array<{ path: string; size: number; mtime: number }>).map(
        (r) => [r.path, r]
      )
    )
    const seen = new Set<string>()
    const langCount = new Map<string, number>()
    const delChunks = d.prepare('DELETE FROM project_chunks WHERE workspace = ? AND path = ?')
    const insChunk = d.prepare('INSERT INTO project_chunks(workspace, path, start_line, content) VALUES(?,?,?,?)')
    const upFile = d.prepare(
      'INSERT INTO project_files(workspace, path, size, mtime, language) VALUES(?,?,?,?,?) ON CONFLICT(workspace, path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, language=excluded.language'
    )
    let processed = 0
    let batch: Array<() => void> = []
    const flush = () => {
      const run = d.transaction(() => batch.forEach((f) => f()))
      run()
      batch = []
    }

    for await (const abs of walkFiles(ws, MAX_FILES)) {
      if (token !== this.runToken) return this.getStatus()
      const rel = path.relative(ws, abs).split(path.sep).join('/')
      seen.add(rel)
      const lang = languageOf(abs)
      if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1)
      let stat
      try {
        stat = await fsp.stat(abs)
      } catch {
        continue
      }
      const prev = known.get(rel)
      const mtime = Math.floor(stat.mtimeMs)
      if (prev && prev.size === stat.size && prev.mtime === mtime) continue
      if (stat.size > MAX_FILE_BYTES) {
        batch.push(() => {
          delChunks.run(ws, rel)
          upFile.run(ws, rel, stat.size, mtime, lang)
        })
        continue
      }
      let text: string
      try {
        const buf = await fsp.readFile(abs)
        if (isProbablyBinary(buf)) continue
        text = buf.toString('utf8')
      } catch {
        continue
      }
      const lines = text.split(/\r?\n/)
      batch.push(() => {
        delChunks.run(ws, rel)
        for (let i = 0; i < lines.length; i += CHUNK_LINES) {
          insChunk.run(ws, rel, i + 1, lines.slice(i, i + CHUNK_LINES).join('\n'))
        }
        upFile.run(ws, rel, stat.size, mtime, lang)
      })
      if (batch.length >= 100) {
        flush()
        processed += 100
        this.status = { ...this.status, files: processed }
        this.emit(this.getStatus())
        await new Promise((r) => setImmediate(r))
      }
    }
    flush()

    // Remove files that no longer exist.
    const removed = [...known.keys()].filter((p) => !seen.has(p))
    const delFile = d.prepare('DELETE FROM project_files WHERE workspace = ? AND path = ?')
    d.transaction(() => {
      for (const p of removed) {
        delChunks.run(ws, p)
        delFile.run(ws, p)
      }
    })()

    const summary = await buildProjectSummary(ws, langCount, seen.size)
    const now = Date.now()
    d.prepare(
      `INSERT INTO projects(workspace, summary, notes, last_indexed, updated_at) VALUES(?, ?, '', ?, ?)
       ON CONFLICT(workspace) DO UPDATE SET summary = excluded.summary, last_indexed = excluded.last_indexed, updated_at = excluded.updated_at`
    ).run(ws, summary, now, now)

    const files = (d.prepare('SELECT COUNT(*) n FROM project_files WHERE workspace = ?').get(ws) as { n: number }).n
    const chunks = (d.prepare('SELECT COUNT(*) n FROM project_chunks WHERE workspace = ?').get(ws) as { n: number }).n
    this.status = { workspace: ws, files, chunks, indexing: false, lastIndexed: now }
    this.emit(this.getStatus())
    return this.getStatus()
  }

  /** Best-matching code chunks for a query, limited to a character budget. */
  search(ws: string, query: string, budgetChars: number, exclude: Set<string> = new Set()): Array<{ path: string; startLine: number; content: string }> {
    const q = ftsQuery(query)
    if (!q) return []
    let rows: Array<{ path: string; start_line: number; content: string }>
    try {
      rows = getDb()
        .prepare(
          'SELECT path, start_line, content FROM project_chunks WHERE workspace = ? AND project_chunks MATCH ? ORDER BY bm25(project_chunks) LIMIT 30'
        )
        .all(ws, q) as typeof rows
    } catch {
      return []
    }
    const out: Array<{ path: string; startLine: number; content: string }> = []
    let used = 0
    for (const r of rows) {
      if (exclude.has(r.path)) continue
      if (used + r.content.length > budgetChars) continue
      out.push({ path: r.path, startLine: r.start_line, content: r.content })
      used += r.content.length
      if (out.length >= 8) break
    }
    return out
  }

  listFiles(ws: string, limit = 400): string[] {
    return (getDb().prepare('SELECT path FROM project_files WHERE workspace = ? ORDER BY path LIMIT ?').all(ws, limit) as Array<{ path: string }>).map((r) => r.path)
  }
}

async function buildProjectSummary(ws: string, langs: Map<string, number>, fileCount: number): Promise<string> {
  const lines: string[] = []
  lines.push(`Project: ${path.basename(ws)} (${fileCount} files indexed)`)
  const top = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (top.length) lines.push('Languages: ' + top.map(([l, n]) => `${l} (${n})`).join(', '))
  try {
    const entries = await fsp.readdir(ws, { withFileTypes: true })
    lines.push('Top level: ' + entries.slice(0, 40).map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join(', '))
  } catch {
    /* ignore */
  }
  for (const f of ['package.json', 'requirements.txt', 'pyproject.toml', 'pom.xml', 'build.gradle', 'CMakeLists.txt', 'Cargo.toml', 'go.mod']) {
    try {
      const txt = await fsp.readFile(path.join(ws, f), 'utf8')
      if (f === 'package.json') {
        const pkg = JSON.parse(txt) as { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string> }
        lines.push(`package.json: name=${pkg.name ?? '?'}; scripts=${Object.keys(pkg.scripts ?? {}).join(', ')}; deps=${Object.keys(pkg.dependencies ?? {}).slice(0, 20).join(', ')}`)
      } else {
        lines.push(`${f}: ${txt.slice(0, 400).replace(/\s+/g, ' ')}`)
      }
    } catch {
      /* missing */
    }
  }
  for (const f of ['README.md', 'readme.md', 'README.txt']) {
    try {
      const txt = await fsp.readFile(path.join(ws, f), 'utf8')
      lines.push(`README excerpt: ${txt.slice(0, 1200)}`)
      break
    } catch {
      /* missing */
    }
  }
  return lines.join('\n')
}

export function getProjectMemory(ws: string): ProjectMemory | null {
  const r = getDb().prepare('SELECT workspace, summary, notes, updated_at FROM projects WHERE workspace = ?').get(ws) as
    | { workspace: string; summary: string; notes: string; updated_at: number }
    | undefined
  return r ? { workspace: r.workspace, summary: r.summary, notes: r.notes, updatedAt: r.updated_at } : null
}

export function setProjectNotes(ws: string, notes: string): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects(workspace, summary, notes, updated_at) VALUES(?, '', ?, ?)
       ON CONFLICT(workspace) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at`
    )
    .run(ws, notes, now)
}

export function appendProjectNote(ws: string, note: string): void {
  const cur = getProjectMemory(ws)?.notes ?? ''
  const lines = cur.split('\n').filter(Boolean)
  lines.push(`- ${note}`)
  setProjectNotes(ws, lines.slice(-40).join('\n'))
}

export function clearProjectMemory(ws: string): void {
  const d = getDb()
  d.prepare('DELETE FROM project_chunks WHERE workspace = ?').run(ws)
  d.prepare('DELETE FROM project_files WHERE workspace = ?').run(ws)
  d.prepare('DELETE FROM projects WHERE workspace = ?').run(ws)
}

export function treeToText(node: FileNode, root: string, maxLines = 150): string {
  const out: string[] = []
  const walk = (n: FileNode, depth: number) => {
    if (out.length >= maxLines) return
    for (const c of n.children ?? []) {
      if (out.length >= maxLines) {
        out.push('  '.repeat(depth) + '…')
        return
      }
      out.push('  '.repeat(depth) + c.name + (c.type === 'directory' ? '/' : ''))
      if (c.type === 'directory' && !c.truncated) walk(c, depth + 1)
    }
  }
  walk(node, 0)
  void root
  return out.join('\n')
}
