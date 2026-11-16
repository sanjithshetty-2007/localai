import path from 'node:path'
import fs from 'node:fs'

/**
 * Holds the currently open workspace root and validates every path the renderer
 * or the AI hands to the main process. Nothing outside the root is ever touched.
 */
let workspaceRoot: string | null = null

export function setWorkspaceRoot(root: string | null): void {
  workspaceRoot = root ? fs.realpathSync.native(path.resolve(root)) : null
}

export function getWorkspaceRoot(): string | null {
  return workspaceRoot
}

export function requireWorkspace(): string {
  if (!workspaceRoot) throw new Error('No workspace is open. Open a folder first.')
  return workspaceRoot
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Resolve the deepest existing ancestor through realpath so symlinks cannot escape the root. */
function realpathLenient(p: string): string {
  let current = p
  const tail: string[] = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    tail.unshift(path.basename(current))
    current = parent
  }
  const real = fs.existsSync(current) ? fs.realpathSync.native(current) : current
  return path.join(real, ...tail)
}

/**
 * Validate a path (absolute or workspace-relative) and return its absolute form.
 * Throws if it would leave the workspace.
 */
export function resolveInWorkspace(p: string): string {
  const root = requireWorkspace()
  if (typeof p !== 'string' || p.trim() === '') throw new Error('Path must be a non-empty string')
  if (p.includes('\0')) throw new Error('Invalid path')
  const cleaned = p.replace(/^["'`]+|["'`]+$/g, '').trim()
  const abs = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(root, cleaned)
  const real = realpathLenient(abs)
  if (!isInside(root, real)) throw new Error(`Path is outside the workspace: ${p}`)
  return real
}

export function toRelative(abs: string): string {
  const root = requireWorkspace()
  return path.relative(root, abs).split(path.sep).join('/')
}

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  'target',
  '.gradle',
  '.cache',
  'coverage',
  '.pytest_cache',
  '.mypy_cache'
])
