import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FileNode, SearchHit } from '../../shared/types'
import { IGNORED_DIRS, requireWorkspace, resolveInWorkspace } from '../security/paths'

const MAX_TREE_NODES = 20000
const MAX_READ_BYTES = 8 * 1024 * 1024

export async function buildTree(root: string): Promise<FileNode> {
  let count = 0
  async function walk(dir: string): Promise<FileNode[]> {
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    const nodes: FileNode[] = []
    for (const e of entries) {
      if (count >= MAX_TREE_NODES) break
      const full = path.join(dir, e.name)
      count++
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) {
          nodes.push({ name: e.name, path: full, type: 'directory', children: [], truncated: true })
        } else {
          nodes.push({ name: e.name, path: full, type: 'directory', children: await walk(full) })
        }
      } else if (e.isFile() || e.isSymbolicLink()) {
        nodes.push({ name: e.name, path: full, type: 'file' })
      }
    }
    return nodes
  }
  return { name: path.basename(root) || root, path: root, type: 'directory', children: await walk(root) }
}

export async function listDirectory(dirPath: string): Promise<FileNode[]> {
  const dir = resolveInWorkspace(dirPath)
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() || e.isFile())
    .map((e) => ({
      name: e.name,
      path: path.join(dir, e.name),
      type: e.isDirectory() ? ('directory' as const) : ('file' as const),
      children: e.isDirectory() ? [] : undefined,
      truncated: e.isDirectory() ? true : undefined
    }))
}

export function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000)
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true
  return false
}

export async function readText(p: string): Promise<string> {
  const abs = resolveInWorkspace(p)
  const stat = await fsp.stat(abs)
  if (stat.isDirectory()) throw new Error('Cannot open a directory as a file')
  if (stat.size > MAX_READ_BYTES) throw new Error(`File is too large to open (${(stat.size / 1048576).toFixed(1)} MB)`)
  const buf = await fsp.readFile(abs)
  if (isProbablyBinary(buf)) throw new Error('This looks like a binary file and cannot be opened as text')
  return buf.toString('utf8')
}

export async function writeText(p: string, content: string): Promise<void> {
  const abs = resolveInWorkspace(p)
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, content, 'utf8')
}

export async function createFile(p: string): Promise<void> {
  const abs = resolveInWorkspace(p)
  if (fs.existsSync(abs)) throw new Error(`Already exists: ${path.basename(abs)}`)
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, '', { flag: 'wx' })
}

export async function createDir(p: string): Promise<void> {
  const abs = resolveInWorkspace(p)
  await fsp.mkdir(abs, { recursive: true })
}

export async function renamePath(from: string, to: string): Promise<void> {
  const a = resolveInWorkspace(from)
  const b = resolveInWorkspace(to)
  if (a === requireWorkspace()) throw new Error('Cannot rename the workspace root')
  if (fs.existsSync(b)) throw new Error(`Target already exists: ${path.basename(b)}`)
  await fsp.mkdir(path.dirname(b), { recursive: true })
  await fsp.rename(a, b)
}

export async function movePath(from: string, toDir: string): Promise<string> {
  const a = resolveInWorkspace(from)
  const dir = resolveInWorkspace(toDir)
  const target = path.join(dir, path.basename(a))
  if (target === a) return a
  if ((dir + path.sep).startsWith(a + path.sep)) throw new Error('Cannot move a folder into itself')
  await renamePath(a, target)
  return target
}

const SEARCH_SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.lock', '.woff', '.woff2', '.ttf', '.mp4', '.mp3', '.db', '.sqlite'])

export async function* walkFiles(root: string, maxFiles = 20000): AsyncGenerator<string> {
  let count = 0
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(full)
      } else if (e.isFile()) {
        if (SEARCH_SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue
        yield full
        if (++count >= maxFiles) return
      }
    }
  }
}

export async function searchWorkspace(
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean },
  maxHits = 2000
): Promise<SearchHit[]> {
  const root = requireWorkspace()
  if (!query) return []
  let re: RegExp
  try {
    re = opts.regex
      ? new RegExp(query, opts.caseSensitive ? '' : 'i')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.caseSensitive ? '' : 'i')
  } catch (e) {
    throw new Error(`Invalid regular expression: ${(e as Error).message}`)
  }
  const hits: SearchHit[] = []
  for await (const file of walkFiles(root)) {
    try {
      const stat = await fsp.stat(file)
      if (stat.size > 1024 * 1024) continue
      const buf = await fsp.readFile(file)
      if (isProbablyBinary(buf)) continue
      const lines = buf.toString('utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push({ path: file, line: i + 1, text: lines[i].slice(0, 300) })
          if (hits.length >= maxHits) return hits
        }
      }
    } catch {
      /* unreadable file: skip */
    }
  }
  return hits
}

/** Debounced recursive watcher for the open workspace. */
export class WorkspaceWatcher {
  private watcher: fs.FSWatcher | null = null
  private pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private onChange: (paths: string[]) => void) {}

  start(root: string): void {
    this.stop()
    try {
      this.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const name = filename.toString()
        const parts = name.split(/[\\/]/)
        if (parts.some((p) => IGNORED_DIRS.has(p))) return
        this.pending.add(path.join(root, name))
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          const paths = [...this.pending]
          this.pending.clear()
          this.onChange(paths)
        }, 250)
      })
      this.watcher.on('error', () => this.stop())
    } catch {
      // Recursive watching is unavailable on some platforms; the explorer still has a Refresh button.
      this.watcher = null
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearTimeout(this.timer)
  }
}
