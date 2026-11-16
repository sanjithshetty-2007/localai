import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { diffLines } from 'diff'
import type { ChangeItem, ChangeSet, FileAction } from '../../shared/types'
import { getDb, newId } from './db'
import { requireWorkspace, resolveInWorkspace, toRelative } from '../security/paths'
import { parseCommand } from '../security/commands'
import type { CodeRunner } from '../terminal/runner'

export { FileActionSchema, READ_ONLY_TYPES, parseActions, type ParsedOutput } from './action-parser'
import { READ_ONLY_TYPES } from './action-parser'

// ---------- Change sets ----------

function countLines(before: string, after: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of diffLines(before, after)) {
    if (part.added) added += part.count ?? 0
    else if (part.removed) removed += part.count ?? 0
  }
  return { added, removed }
}

function readIfExists(abs: string): string | null {
  try {
    return fs.statSync(abs).isFile() ? fs.readFileSync(abs, 'utf8') : null
  } catch {
    return null
  }
}

/** Validate actions against the workspace and build a pending change set. */
export function buildChangeSet(
  conversationId: string,
  messageId: string,
  actions: FileAction[]
): { changeSet: ChangeSet | null; errors: string[] } {
  const ws = requireWorkspace()
  const errors: string[] = []
  const byPath = new Map<string, ChangeItem>()
  const items: ChangeItem[] = []

  for (const a of actions) {
    if (READ_ONLY_TYPES.has(a.type)) continue
    try {
      if (a.type === 'create_file' || a.type === 'edit_file') {
        const abs = resolveInWorkspace(a.path)
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) throw new Error(`${a.path} is a directory`)
        const rel = toRelative(abs)
        const original = readIfExists(abs)
        const action: FileAction = { type: original === null ? 'create_file' : 'edit_file', path: rel, content: a.content }
        if (original !== null && original === a.content) continue // no change
        const counts = countLines(original ?? '', a.content)
        const item: ChangeItem = { id: newId('chg_'), action, status: 'pending', original, destructive: false, ...counts }
        const prev = byPath.get(rel)
        if (prev) items.splice(items.indexOf(prev), 1, item)
        else items.push(item)
        byPath.set(rel, item)
      } else if (a.type === 'delete_file') {
        const abs = resolveInWorkspace(a.path)
        if (abs === ws) throw new Error('Refusing to delete the workspace root')
        if (!fs.existsSync(abs)) throw new Error(`${a.path} does not exist`)
        const original = readIfExists(abs)
        items.push({ id: newId('chg_'), action: { type: 'delete_file', path: toRelative(abs) }, status: 'pending', original, destructive: true, removed: original?.split('\n').length ?? 0, added: 0 })
      } else if (a.type === 'rename_file') {
        const from = resolveInWorkspace(a.from)
        const to = resolveInWorkspace(a.to)
        if (!fs.existsSync(from)) throw new Error(`${a.from} does not exist`)
        if (fs.existsSync(to)) throw new Error(`${a.to} already exists`)
        items.push({ id: newId('chg_'), action: { type: 'rename_file', from: toRelative(from), to: toRelative(to) }, status: 'pending', original: null, destructive: true })
      } else if (a.type === 'create_directory') {
        const abs = resolveInWorkspace(a.path)
        if (fs.existsSync(abs)) continue
        items.push({ id: newId('chg_'), action: { type: 'create_directory', path: toRelative(abs) }, status: 'pending', original: null, destructive: false })
      } else if (a.type === 'run_command') {
        const parsed = parseCommand(a.command)
        if (a.cwd) resolveInWorkspace(a.cwd)
        // Every command needs explicit approval; destructive ones are flagged in the UI.
        items.push({ id: newId('chg_'), action: { type: 'run_command', command: a.command, cwd: a.cwd }, status: 'pending', original: null, destructive: parsed.destructive })
      }
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  if (!items.length) return { changeSet: null, errors }
  const changeSet: ChangeSet = { id: newId('cs_'), conversationId, messageId, workspace: ws, createdAt: Date.now(), items }
  saveChangeSet(changeSet)
  return { changeSet, errors }
}

export function saveChangeSet(cs: ChangeSet): void {
  getDb()
    .prepare(
      'INSERT INTO changesets(id, conversation_id, message_id, workspace, data, created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
    )
    .run(cs.id, cs.conversationId, cs.messageId, cs.workspace, JSON.stringify(cs), cs.createdAt)
}

export function loadChangeSet(id: string): ChangeSet | null {
  const r = getDb().prepare('SELECT data FROM changesets WHERE id = ?').get(id) as { data: string } | undefined
  return r ? (JSON.parse(r.data) as ChangeSet) : null
}

function assertWorkspace(cs: ChangeSet): void {
  const ws = requireWorkspace()
  if (path.resolve(ws) !== path.resolve(cs.workspace)) {
    throw new Error(`These changes belong to another workspace (${cs.workspace}). Open it to apply them.`)
  }
}

async function trashOrRemove(abs: string): Promise<void> {
  try {
    await shell.trashItem(abs)
  } catch {
    await fsp.rm(abs, { recursive: true, force: true })
  }
}

export async function applyChangeSet(id: string, itemIds: string[] | undefined, runner: CodeRunner): Promise<{ cs: ChangeSet; touched: string[] }> {
  const cs = loadChangeSet(id)
  if (!cs) throw new Error('Change set not found')
  assertWorkspace(cs)
  const touched: string[] = []
  for (const item of cs.items) {
    if (item.status !== 'pending' && item.status !== 'failed') continue
    if (itemIds && !itemIds.includes(item.id)) continue
    const a = item.action
    try {
      if (a.type === 'create_file' || a.type === 'edit_file') {
        const abs = resolveInWorkspace(a.path)
        item.original = readIfExists(abs)
        await fsp.mkdir(path.dirname(abs), { recursive: true })
        await fsp.writeFile(abs, a.content, 'utf8')
        touched.push(abs)
      } else if (a.type === 'delete_file') {
        const abs = resolveInWorkspace(a.path)
        item.original = readIfExists(abs)
        await trashOrRemove(abs)
        touched.push(abs)
      } else if (a.type === 'rename_file') {
        const from = resolveInWorkspace(a.from)
        const to = resolveInWorkspace(a.to)
        if (fs.existsSync(to)) throw new Error(`${a.to} already exists`)
        await fsp.mkdir(path.dirname(to), { recursive: true })
        await fsp.rename(from, to)
        touched.push(from, to)
      } else if (a.type === 'create_directory') {
        const abs = resolveInWorkspace(a.path)
        await fsp.mkdir(abs, { recursive: true })
        touched.push(abs)
      } else if (a.type === 'run_command') {
        const cwd = a.cwd ? resolveInWorkspace(a.cwd) : requireWorkspace()
        const { result } = await runner.runCommand(a.command, cwd)
        item.output = (result.stdout + (result.stderr ? '\n' + result.stderr : '')).slice(-4000)
        if (result.status !== 'success') throw new Error(`Command exited with code ${result.exitCode ?? 'none'}`)
      }
      item.status = 'applied'
      item.error = undefined
    } catch (e) {
      item.status = 'failed'
      item.error = (e as Error).message
    }
  }
  saveChangeSet(cs)
  return { cs, touched }
}

export function rejectChangeSet(id: string, itemIds?: string[]): ChangeSet {
  const cs = loadChangeSet(id)
  if (!cs) throw new Error('Change set not found')
  for (const item of cs.items) {
    if (item.status === 'pending' && (!itemIds || itemIds.includes(item.id))) item.status = 'rejected'
  }
  saveChangeSet(cs)
  return cs
}

export async function undoChangeSet(id: string): Promise<{ cs: ChangeSet; touched: string[] }> {
  const cs = loadChangeSet(id)
  if (!cs) throw new Error('Change set not found')
  assertWorkspace(cs)
  const touched: string[] = []
  for (const item of [...cs.items].reverse()) {
    if (item.status !== 'applied') continue
    const a = item.action
    try {
      if (a.type === 'create_file' || a.type === 'edit_file') {
        const abs = resolveInWorkspace(a.path)
        if (item.original === null) await trashOrRemove(abs)
        else await fsp.writeFile(abs, item.original, 'utf8')
        touched.push(abs)
      } else if (a.type === 'delete_file') {
        if (item.original !== null) {
          const abs = resolveInWorkspace(a.path)
          await fsp.mkdir(path.dirname(abs), { recursive: true })
          await fsp.writeFile(abs, item.original, 'utf8')
          touched.push(abs)
        } else continue // binary/dir deletions are in the system trash
      } else if (a.type === 'rename_file') {
        const from = resolveInWorkspace(a.from)
        const to = resolveInWorkspace(a.to)
        await fsp.rename(to, from)
        touched.push(from, to)
      } else if (a.type === 'create_directory') {
        const abs = resolveInWorkspace(a.path)
        try {
          await fsp.rmdir(abs)
        } catch {
          continue // not empty: leave it
        }
      } else continue // commands cannot be undone
      item.status = 'pending'
    } catch (e) {
      item.error = `Undo failed: ${(e as Error).message}`
    }
  }
  saveChangeSet(cs)
  return { cs, touched }
}

/** Build a change set for a single direct edit (e.g. "Apply" on a code block or an inline fix). */
export function proposeEdit(conversationId: string, filePath: string, content: string): ChangeSet {
  const { changeSet, errors } = buildChangeSet(conversationId, 'manual', [{ type: 'edit_file', path: filePath, content }])
  if (!changeSet) throw new Error(errors[0] ?? 'The proposed code is identical to the current file.')
  return changeSet
}
