import type { Attachment, ChatMessage, Conversation, MessageMeta } from '../../shared/types'
import { getDb, newId } from './db'
import { getAttachments } from './documents'

interface MsgRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  model: string | null
  meta: string | null
  attachment_ids: string | null
  created_at: number
}

function rowToMessage(r: MsgRow, withAttachments = true): ChatMessage {
  const ids = r.attachment_ids ? (JSON.parse(r.attachment_ids) as string[]) : []
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    model: r.model ?? undefined,
    meta: r.meta ? (JSON.parse(r.meta) as MessageMeta) : undefined,
    attachments: withAttachments && ids.length ? getAttachments(ids) : ids.length ? ids.map((id) => ({ id } as Attachment)) : undefined
  }
}

export function listConversations(): Conversation[] {
  return (getDb().prepare('SELECT id, title, workspace, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 200').all() as Array<{
    id: string
    title: string
    workspace: string | null
    created_at: number
    updated_at: number
  }>).map((r) => ({ id: r.id, title: r.title, workspace: r.workspace, createdAt: r.created_at, updatedAt: r.updated_at }))
}

export function createConversation(workspace: string | null): Conversation {
  const now = Date.now()
  const c: Conversation = { id: newId('conv_'), title: 'New chat', createdAt: now, updatedAt: now, workspace }
  getDb().prepare('INSERT INTO conversations(id, title, workspace, created_at, updated_at) VALUES(?,?,?,?,?)').run(c.id, c.title, workspace, now, now)
  return c
}

export function getConversation(id: string): (Conversation & { summary: string | null; summaryUpto: number }) | null {
  const r = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | { id: string; title: string; workspace: string | null; summary: string | null; summary_upto: number; created_at: number; updated_at: number }
    | undefined
  if (!r) return null
  return { id: r.id, title: r.title, workspace: r.workspace, summary: r.summary, summaryUpto: r.summary_upto ?? 0, createdAt: r.created_at, updatedAt: r.updated_at }
}

export function renameConversation(id: string, title: string): void {
  getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title.slice(0, 120), id)
}

export function touchConversation(id: string, workspace?: string | null): void {
  if (workspace !== undefined) getDb().prepare('UPDATE conversations SET updated_at = ?, workspace = COALESCE(?, workspace) WHERE id = ?').run(Date.now(), workspace, id)
  else getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function setConversationSummary(id: string, summary: string, upto: number): void {
  getDb().prepare('UPDATE conversations SET summary = ?, summary_upto = ? WHERE id = ?').run(summary, upto, id)
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function clearConversation(id: string): void {
  getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
  getDb().prepare("UPDATE conversations SET summary = NULL, summary_upto = 0, title = 'New chat' WHERE id = ?").run(id)
}

export function getMessages(conversationId: string, withAttachments = true): ChatMessage[] {
  const rows = getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC').all(conversationId) as MsgRow[]
  return rows.map((r) => rowToMessage(r, withAttachments))
}

export function insertMessage(m: Omit<ChatMessage, 'attachments'> & { attachmentIds?: string[] }): void {
  getDb()
    .prepare('INSERT INTO messages(id, conversation_id, role, content, model, meta, attachment_ids, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(
      m.id,
      m.conversationId,
      m.role,
      m.content,
      m.model ?? null,
      m.meta ? JSON.stringify(m.meta) : null,
      m.attachmentIds?.length ? JSON.stringify(m.attachmentIds) : null,
      m.createdAt
    )
}

export function updateMessageMeta(id: string, patch: Partial<MessageMeta>): void {
  const r = getDb().prepare('SELECT meta FROM messages WHERE id = ?').get(id) as { meta: string | null } | undefined
  if (!r) return
  const meta = { ...(r.meta ? (JSON.parse(r.meta) as MessageMeta) : {}), ...patch }
  getDb().prepare('UPDATE messages SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id)
}

export function deleteMessage(id: string): void {
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(id)
}

export function messageAttachmentIds(id: string): string[] {
  const r = getDb().prepare('SELECT attachment_ids FROM messages WHERE id = ?').get(id) as { attachment_ids: string | null } | undefined
  return r?.attachment_ids ? (JSON.parse(r.attachment_ids) as string[]) : []
}
