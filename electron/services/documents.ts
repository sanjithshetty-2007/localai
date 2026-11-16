import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import type { Attachment, AttachmentKind } from '../../shared/types'
import { getDb, newId } from './db'
import { safeExtractZip } from '../filesystem/zip'
import { getWorkspaceRoot } from '../security/paths'
import { isProbablyBinary } from '../filesystem/fs-service'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.java', '.json', '.html', '.css', '.scss', '.xml', '.yml', '.yaml', '.toml', '.ini', '.csv', '.sql', '.sh', '.ps1',
  '.go', '.rs', '.rb', '.php', '.cs', '.kt', '.swift', '.log', '.env', '.gitignore'
])

const LIMITS: Record<AttachmentKind, number> = {
  image: 20 * 1024 * 1024,
  pdf: 100 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  zip: 500 * 1024 * 1024
}

const CHUNK_CHARS = 1500

function kindFor(file: string): AttachmentKind | null {
  const ext = path.extname(file).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.zip') return 'zip'
  if (TEXT_EXT.has(ext) || ext === '') return 'text'
  return null
}

interface StoredAttachment {
  id: string
  kind: AttachmentKind
  name: string
  size: number
  mime: string | null
  info: string | null
  image_b64: string | null
  text_content: string | null
}

function rowToAttachment(r: StoredAttachment): Attachment {
  const info = r.info ? (JSON.parse(r.info) as Partial<Attachment>) : {}
  return { id: r.id, kind: r.kind, name: r.name, size: r.size, mime: r.mime ?? undefined, ...info }
}

function save(att: Attachment, imageB64: string | null, text: string | null): void {
  const { id, kind, name, size, mime, ...info } = att
  getDb()
    .prepare(
      'INSERT INTO attachments(id, kind, name, size, mime, info, image_b64, text_content, created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .run(id, kind, name, size, mime ?? null, JSON.stringify(info), imageB64, text, Date.now())
}

function chunkText(attId: string, pages: string[]): void {
  const insert = getDb().prepare('INSERT INTO attachment_chunks(attachment_id, seq, page, content) VALUES(?,?,?,?)')
  let seq = 0
  const tx = getDb().transaction(() => {
    pages.forEach((pageText, pi) => {
      const paras = pageText.split(/\n{2,}/)
      let buf = ''
      for (const p of paras) {
        if ((buf + '\n\n' + p).length > CHUNK_CHARS && buf) {
          insert.run(attId, seq++, pi + 1, buf)
          buf = ''
        }
        buf = buf ? buf + '\n\n' + p : p
        while (buf.length > CHUNK_CHARS * 1.5) {
          insert.run(attId, seq++, pi + 1, buf.slice(0, CHUNK_CHARS))
          buf = buf.slice(CHUNK_CHARS)
        }
      }
      if (buf.trim()) insert.run(attId, seq++, pi + 1, buf)
    })
  })
  tx()
}

function prepareImage(buf: Buffer): { b64: string; preview: string } {
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) {
    // Format nativeImage cannot decode (e.g. some WEBP): send the original bytes to Ollama.
    return { b64: buf.toString('base64'), preview: '' }
  }
  const { width, height } = img.getSize()
  const maxSide = 1600
  const scaled = Math.max(width, height) > maxSide
    ? img.resize(width >= height ? { width: maxSide } : { height: maxSide, quality: 'best' })
    : img
  const thumb = img.resize(width >= height ? { width: 160 } : { height: 120 })
  return { b64: scaled.toPNG().toString('base64'), preview: thumb.toDataURL() }
}

export async function extractPdf(buf: Buffer): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(pdf, { mergePages: false })
  return Array.isArray(text) ? text : [String(text)]
}

function uniqueDir(base: string): string {
  let dir = base
  let i = 1
  while (fs.existsSync(dir)) dir = `${base}-${i++}`
  return dir
}

export async function addAttachmentFromPath(filePath: string): Promise<Attachment> {
  const name = path.basename(filePath)
  const kind = kindFor(filePath)
  if (!kind) throw new Error(`Unsupported file type: ${name}`)
  const stat = await fsp.stat(filePath)
  if (!stat.isFile()) throw new Error(`${name} is not a file`)
  if (stat.size > LIMITS[kind]) {
    throw new Error(`${name} is too large (${(stat.size / 1048576).toFixed(1)} MB, limit ${LIMITS[kind] / 1048576} MB)`)
  }
  const id = newId('att_')

  if (kind === 'image') {
    const buf = await fsp.readFile(filePath)
    const { b64, preview } = prepareImage(buf)
    const att: Attachment = { id, kind, name, size: stat.size, mime: 'image/png', preview }
    save(att, b64, null)
    return att
  }

  if (kind === 'pdf') {
    const buf = await fsp.readFile(filePath)
    let pages: string[]
    try {
      pages = await extractPdf(buf)
    } catch (e) {
      throw new Error(`Could not read PDF ${name}: ${(e as Error).message}`)
    }
    const full = pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n')
    const chars = pages.reduce((n, p) => n + p.length, 0)
    const att: Attachment = {
      id,
      kind,
      name,
      size: stat.size,
      mime: 'application/pdf',
      pages: pages.length,
      chars,
      note: chars < 20 ? 'No extractable text (the PDF may be scanned images).' : undefined
    }
    save(att, null, full)
    chunkText(id, pages)
    return att
  }

  if (kind === 'zip') {
    const ws = getWorkspaceRoot()
    const baseName = name.replace(/\.zip$/i, '').replace(/[^\w.-]+/g, '_') || 'archive'
    const dest = uniqueDir(
      ws ? path.join(ws, baseName) : path.join(app.getPath('userData'), 'imports', baseName)
    )
    await fsp.mkdir(dest, { recursive: true })
    try {
      const { files } = await safeExtractZip(filePath, dest)
      const att: Attachment = { id, kind, name, size: stat.size, extractedTo: dest, fileCount: files }
      save(att, null, null)
      return att
    } catch (e) {
      await fsp.rm(dest, { recursive: true, force: true })
      throw e
    }
  }

  const buf = await fsp.readFile(filePath)
  if (isProbablyBinary(buf)) throw new Error(`${name} looks like a binary file`)
  const text = buf.toString('utf8')
  const att: Attachment = { id, kind, name, size: stat.size, mime: 'text/plain', chars: text.length }
  save(att, null, text)
  if (text.length > CHUNK_CHARS * 4) chunkText(id, [text])
  return att
}

export function addImageFromDataUrl(name: string, dataUrl: string): Attachment {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl)
  if (!m) throw new Error('Clipboard data is not an image')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > LIMITS.image) throw new Error('Pasted image is too large')
  const { b64, preview } = prepareImage(buf)
  const att: Attachment = { id: newId('att_'), kind: 'image', name, size: buf.length, mime: 'image/png', preview }
  save(att, b64, null)
  return att
}

export function getAttachments(ids: string[]): Attachment[] {
  if (!ids.length) return []
  const rows = getDb()
    .prepare(`SELECT id, kind, name, size, mime, info, NULL as image_b64, NULL as text_content FROM attachments WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as StoredAttachment[]
  const byId = new Map(rows.map((r) => [r.id, rowToAttachment(r)]))
  return ids.map((id) => byId.get(id)).filter((a): a is Attachment => !!a)
}

export function getImageBase64(id: string): string | null {
  const r = getDb().prepare('SELECT image_b64 FROM attachments WHERE id = ?').get(id) as { image_b64: string | null } | undefined
  return r?.image_b64 ?? null
}

export function getAttachmentText(id: string): string | null {
  const r = getDb().prepare('SELECT text_content FROM attachments WHERE id = ?').get(id) as { text_content: string | null } | undefined
  return r?.text_content ?? null
}

export function removeAttachment(id: string): void {
  const d = getDb()
  d.prepare('DELETE FROM attachment_chunks WHERE attachment_id = ?').run(id)
  d.prepare('DELETE FROM attachments WHERE id = ?').run(id)
}

export { ftsQuery, extractNumberedSection } from './text-utils'
import { ftsQuery, extractNumberedSection } from './text-utils'

/**
 * Text for an attachment that fits the budget: the whole document when small,
 * otherwise a numbered section the question asks about plus the best-matching chunks.
 */
export function retrieveAttachmentText(id: string, query: string, budgetChars: number): { text: string; partial: boolean } {
  const full = getAttachmentText(id) ?? ''
  if (full.length <= budgetChars) return { text: full, partial: false }
  const parts: string[] = []
  let used = 0
  const section = extractNumberedSection(full, query, Math.floor(budgetChars * 0.6))
  if (section) {
    parts.push(section)
    used += section.length
  }
  const q = ftsQuery(query)
  const rows = q
    ? (getDb()
        .prepare('SELECT page, content FROM attachment_chunks WHERE attachment_id = ? AND attachment_chunks MATCH ? ORDER BY bm25(attachment_chunks) LIMIT 12')
        .all(id, q) as Array<{ page: number; content: string }>)
    : []
  const fallback = rows.length
    ? rows
    : (getDb().prepare('SELECT page, content FROM attachment_chunks WHERE attachment_id = ? ORDER BY seq LIMIT 6').all(id) as Array<{ page: number; content: string }>)
  for (const r of fallback) {
    if (section && section.includes(r.content.slice(0, 80))) continue
    const piece = `[page ${r.page}] ${r.content}`
    if (used + piece.length > budgetChars) break
    parts.push(piece)
    used += piece.length
  }
  return { text: parts.join('\n\n…\n\n'), partial: true }
}
