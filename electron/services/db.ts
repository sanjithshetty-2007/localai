import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import type { Settings } from '../../shared/types'
import os from 'node:os'
import { PRESET_VERSION, PROFILE_PRESETS, adjustRolesForMemory } from '../../shared/profiles'

const TOTAL_RAM_GB = os.totalmem() / 1073741824

let db: Database.Database | null = null

export function dbPath(): string {
  return path.join(app.getPath('userData'), 'localcode.db')
}

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace TEXT,
      summary TEXT,
      summary_upto INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      meta TEXT,
      attachment_ids TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT,
      info TEXT,
      image_b64 TEXT,
      text_content TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS attachment_chunks USING fts5(
      attachment_id UNINDEXED, seq UNINDEXED, page UNINDEXED, content
    );
    CREATE TABLE IF NOT EXISTS changesets (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      workspace TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      workspace TEXT PRIMARY KEY,
      summary TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      last_indexed INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_files (
      workspace TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      language TEXT,
      PRIMARY KEY (workspace, path)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS project_chunks USING fts5(
      workspace UNINDEXED, path, start_line UNINDEXED, content
    );
  `)
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  ollamaUrl: 'http://localhost:11434',
  profile: 'balanced',
  roles: { ...PROFILE_PRESETS.balanced.roles },
  numCtx: PROFILE_PRESETS.balanced.numCtx,
  temperature: 0.4,
  topP: 0.9,
  keepAlive: '10m',
  autoRouting: true,
  singleModelResidency: true,
  autoApplyEdits: false,
  maxAgentSteps: 4,
  editorFontSize: 14,
  terminalFontSize: 13,
  terminalShell: '',
  defaultWorkspace: null,
  lastWorkspace: null,
  aiSidebarVisible: true,
  aiSidebarWidth: 400,
  knowledgeEnabled: true,
  presetVersion: PRESET_VERSION,
  setupDone: false,
  autoUpdate: true,
  reasoningBudget: 12288,
  doubleCheck: true,
  testCode: false
}

export function getSettings(): Settings {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('app') as
    | { value: string }
    | undefined
  if (!row) return { ...structuredClone(DEFAULT_SETTINGS), roles: adjustRolesForMemory({ ...DEFAULT_SETTINGS.roles }, TOTAL_RAM_GB) }
  try {
    const parsed = JSON.parse(row.value) as Partial<Settings>
    const merged: Settings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      roles: { ...DEFAULT_SETTINGS.roles, ...(parsed.roles ?? {}) }
    }
    // One-time migration to the current model presets for the saved profile.
    if ((parsed.presetVersion ?? 1) < PRESET_VERSION) {
      const preset = PROFILE_PRESETS[merged.profile] ?? PROFILE_PRESETS.balanced
      merged.roles = adjustRolesForMemory({ ...preset.roles }, TOTAL_RAM_GB)
      merged.numCtx = preset.numCtx
      // 1.0.5: Standard reasoning depth is 12K (the 30B needed ~9.8K tokens to self-correct on infix→postfix).
      if (!merged.reasoningBudget || merged.reasoningBudget === 8192) merged.reasoningBudget = 12288
      merged.presetVersion = PRESET_VERSION
      getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(merged), 'app')
    }
    return merged
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  const next: Settings = {
    ...current,
    ...patch,
    // Never select the 30B reasoning model on machines without the RAM for it.
    roles: adjustRolesForMemory({ ...current.roles, ...(patch.roles ?? {}) }, TOTAL_RAM_GB)
  }
  getDb()
    .prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('app', JSON.stringify(next))
  return next
}

export { newId } from '../util/id'
