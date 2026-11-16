import fsp from 'node:fs/promises'
import path from 'node:path'
import yauzl from 'yauzl'
import type { KnowledgeDoc, KnowledgeHit, KnowledgeProgress } from '../../shared/types'
import { getDb, getSettings, newId } from './db'
import { extractPdf } from './documents'
import type { OllamaClient } from './ollama'
import { chunkText, cosine, docxXmlToText, extractNumberedSection, ftsQuery, rrf, slidePassages } from './text-utils'
import { isProbablyBinary } from '../filesystem/fs-service'

/*
 * The knowledge library: reference documents (a syllabus, notes, a textbook chapter)
 * that stay available to every conversation. Text is chunked, embedded locally with the
 * embedding model (nomic-embed-text) and searched with hybrid semantic + keyword ranking.
 */

function normalize(s: string): string {
  return s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9+#]+/g, ' ').trim()
}

const SUPPORTED = /\.(pdf|docx|txt|md|markdown|csv|json|html?|py|js|ts|java|cpp|c)$/i
const MAX_BYTES = 80 * 1024 * 1024
const EMBED_BATCH = 16
// nomic-embed-text expects task prefixes for asymmetric retrieval.
const DOC_PREFIX = 'search_document: '
const QUERY_PREFIX = 'search_query: '
// Relevance gates, calibrated for nomic-embed-text (unrelated questions score ~0.40-0.60).
const SIM_EXPLICIT = 0.45 // the user explicitly refers to their course material
const SIM_WITH_KEYWORD = 0.6 // a keyword also matches
const SIM_ALONE = 0.64 // semantic similarity alone
export const EXPLICIT_REF = /\b(syllabus|curriculum|course|unit|module|chapter|lecture|lab|marks|exam|assessment|outcomes?|credits?|notes|reference|textbook|according to|as per|my (?:material|document|pdf|file))\b/i

export function migrateKnowledge(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      size INTEGER NOT NULL,
      pages INTEGER NOT NULL DEFAULT 0,
      chars INTEGER NOT NULL DEFAULT 0,
      chunks INTEGER NOT NULL DEFAULT 0,
      embedded INTEGER NOT NULL DEFAULT 0,
      embed_model TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      full_text TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      page INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_kchunks_doc ON knowledge_chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(content, chunk_id UNINDEXED);
  `)
}

interface DocRow {
  id: string
  name: string
  kind: string
  size: number
  pages: number
  chars: number
  chunks: number
  embedded: number
  embed_model: string | null
  enabled: number
  error: string | null
  created_at: number
}

function toDoc(r: DocRow): KnowledgeDoc {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    size: r.size,
    pages: r.pages,
    chars: r.chars,
    chunks: r.chunks,
    embedded: r.embedded,
    embedModel: r.embed_model,
    enabled: !!r.enabled,
    error: r.error,
    createdAt: r.created_at
  }
}

function readDocx(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Not a valid .docx file'))
      let found = false
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'word/document.xml') return zip.readEntry()
        found = true
        if (entry.uncompressedSize > 50 * 1024 * 1024) return reject(new Error('document.xml is too large'))
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2 ?? new Error('Cannot read .docx'))
          const parts: Buffer[] = []
          stream.on('data', (d: Buffer) => parts.push(d))
          stream.on('end', () => {
            zip.close()
            resolve(docxXmlToText(Buffer.concat(parts).toString('utf8')))
          })
          stream.on('error', reject)
        })
      })
      zip.on('end', () => !found && reject(new Error('No word/document.xml in this .docx')))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

async function extract(file: string): Promise<{ kind: string; pages: string[] }> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf') return { kind: 'pdf', pages: await extractPdf(await fsp.readFile(file)) }
  if (ext === '.docx') return { kind: 'docx', pages: [await readDocx(file)] }
  const buf = await fsp.readFile(file)
  if (isProbablyBinary(buf)) throw new Error('This looks like a binary file')
  return { kind: ext.slice(1) || 'text', pages: [buf.toString('utf8')] }
}

export class KnowledgeLibrary {
  private vectors: Map<number, Float32Array> | null = null

  constructor(
    private ollama: OllamaClient,
    private emit: (p: KnowledgeProgress) => void
  ) {}

  list(): KnowledgeDoc[] {
    return (getDb().prepare('SELECT id, name, kind, size, pages, chars, chunks, embedded, embed_model, enabled, error, created_at FROM knowledge_docs ORDER BY created_at').all() as DocRow[]).map(toDoc)
  }

  activeDocs(): KnowledgeDoc[] {
    return this.list().filter((d) => d.enabled && d.chunks > 0)
  }

  setEnabled(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE knowledge_docs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    this.invalidate()
  }

  remove(id: string): void {
    const d = getDb()
    d.prepare('DELETE FROM knowledge_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)').run(id)
    d.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(id)
    d.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(id)
    this.invalidate()
  }

  /** Add a document: extract, chunk, store, then embed (keyword search works even if embedding fails). */
  async add(file: string): Promise<KnowledgeDoc> {
    const name = path.basename(file)
    if (!SUPPORTED.test(name)) throw new Error(`${name}: supported types are PDF, DOCX, TXT, MD and code/text files`)
    const stat = await fsp.stat(file)
    if (stat.size > MAX_BYTES) throw new Error(`${name} is larger than ${MAX_BYTES / 1048576} MB`)
    const id = newId('kdoc_')
    this.emit({ docId: id, name, stage: 'extracting', done: 0, total: 0 })
    const extracted = await extract(file)
    const kind = extracted.kind
    const chars = extracted.pages.reduce((n, p) => n + p.length, 0)
    // Slide decks (many short pages): drop repeated headers/footers and merge slides into passages.
    const isSlides = extracted.pages.length >= 8 && chars / extracted.pages.length < 900
    const slides = isSlides ? slidePassages(extracted.pages) : null
    const pages = slides ? slides.cleaned : extracted.pages
    const fullText = pages.map((p, i) => (pages.length > 1 ? `--- Page ${i + 1} ---\n${p}` : p)).join('\n\n')
    if (chars < 20) throw new Error(`${name} has no extractable text (a scanned PDF needs OCR first)`)

    const d = getDb()
    d.prepare('INSERT INTO knowledge_docs(id, name, kind, size, pages, chars, full_text, created_at) VALUES(?,?,?,?,?,?,?,?)').run(
      id, name, kind, stat.size, pages.length, chars, fullText, Date.now()
    )
    const insChunk = d.prepare('INSERT INTO knowledge_chunks(doc_id, seq, page, content) VALUES(?,?,?,?)')
    const insFts = d.prepare('INSERT INTO knowledge_fts(content, chunk_id) VALUES(?, ?)')
    let seq = 0
    d.transaction(() => {
      if (slides) {
        for (const s of slides.passages) {
          const r = insChunk.run(id, seq++, s.page, s.text)
          insFts.run(s.text, Number(r.lastInsertRowid))
        }
      } else {
        pages.forEach((p, pi) => {
          for (const c of chunkText(p)) {
            const r = insChunk.run(id, seq++, pi + 1, c)
            insFts.run(c, Number(r.lastInsertRowid))
          }
        })
      }
      d.prepare('UPDATE knowledge_docs SET chunks = ? WHERE id = ?').run(seq, id)
    })()
    this.invalidate()
    await this.embedDoc(id, name)
    return toDoc(d.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(id) as DocRow)
  }

  /** (Re)compute embeddings for a document's chunks that do not have one. */
  async embedDoc(id: string, name: string): Promise<void> {
    const model = getSettings().roles.embedding
    const d = getDb()
    const rows = d.prepare('SELECT id, content FROM knowledge_chunks WHERE doc_id = ? AND embedding IS NULL ORDER BY seq').all(id) as Array<{ id: number; content: string }>
    const total = (d.prepare('SELECT COUNT(*) n FROM knowledge_chunks WHERE doc_id = ?').get(id) as { n: number }).n
    let done = total - rows.length
    const upd = d.prepare('UPDATE knowledge_chunks SET embedding = ? WHERE id = ?')
    try {
      for (let i = 0; i < rows.length; i += EMBED_BATCH) {
        this.emit({ docId: id, name, stage: 'embedding', done, total })
        const batch = rows.slice(i, i + EMBED_BATCH)
        const vecs = await this.ollama.embed(model, batch.map((r) => DOC_PREFIX + r.content))
        d.transaction(() => batch.forEach((r, j) => upd.run(Buffer.from(new Float32Array(vecs[j]).buffer), r.id)))()
        done += batch.length
      }
      d.prepare('UPDATE knowledge_docs SET embedded = ?, embed_model = ?, error = NULL WHERE id = ?').run(done, model, id)
      this.emit({ docId: id, name, stage: 'ready', done, total })
    } catch (e) {
      const msg = `Semantic search unavailable (${(e as Error).message}). Keyword search still works. Install "${model}" in Settings → Models, then re-embed.`
      d.prepare('UPDATE knowledge_docs SET embedded = ?, error = ? WHERE id = ?').run(done, msg, id)
      this.emit({ docId: id, name, stage: 'error', done, total, error: msg })
    }
    this.vectors = null
  }

  async reembedAll(): Promise<void> {
    for (const doc of this.list()) {
      if (doc.embedModel && doc.embedModel !== getSettings().roles.embedding) {
        getDb().prepare('UPDATE knowledge_chunks SET embedding = NULL WHERE doc_id = ?').run(doc.id)
      }
      await this.embedDoc(doc.id, doc.name)
    }
  }

  private loadVectors(): Map<number, Float32Array> {
    if (this.vectors) return this.vectors
    const rows = getDb()
      .prepare('SELECT c.id, c.embedding FROM knowledge_chunks c JOIN knowledge_docs d ON d.id = c.doc_id WHERE d.enabled = 1 AND c.embedding IS NOT NULL')
      .all() as Array<{ id: number; embedding: Buffer }>
    this.vectors = new Map(rows.map((r) => [r.id, new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)]))
    return this.vectors
  }

  invalidate(): void {
    this.vectors = null
    this.sections = null
  }

  private sections: Array<{ docId: string; docName: string; page: number; phrases: RegExp[]; phraseText: string[]; chunkIds: number[]; title: string }> | null = null

  /** Markdown "## Title" sections (with "Also called:" aliases) across active documents. */
  private sectionIndex() {
    if (this.sections) return this.sections
    const rows = getDb()
      .prepare(
        "SELECT c.id, c.doc_id, c.page, c.content, k.name FROM knowledge_chunks c JOIN knowledge_docs k ON k.id = c.doc_id WHERE k.enabled = 1 AND c.content LIKE '## %' ORDER BY c.doc_id, c.page, c.seq"
      )
      .all() as Array<{ id: number; doc_id: string; page: number; content: string; name: string }>
    const byKey = new Map<string, { docId: string; docName: string; page: number; phrases: RegExp[]; phraseText: string[]; chunkIds: number[]; title: string }>()
    for (const r of rows) {
      const key = `${r.doc_id}:${r.page}`
      const lines = r.content.split('\n')
      const title = lines[0].replace(/^##\s*/, '').replace(/\s*\(cont\.\)$/, '').trim()
      let entry = byKey.get(key)
      if (!entry) {
        const aliasLine = lines.find((l) => /^also called:/i.test(l))
        const phrases = [title, ...(aliasLine ? aliasLine.replace(/^also called:/i, '').split(',') : [])].map(normalize).filter((p) => p.length >= 3)
        entry = {
          docId: r.doc_id,
          docName: r.name,
          page: r.page,
          title,
          phraseText: phrases,
          phrases: phrases.map((p) => new RegExp(`(^| )${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?( |$)`)),
          chunkIds: []
        }
        byKey.set(key, entry)
      }
      entry.chunkIds.push(r.id)
    }
    // Continuation chunks of a section do not start with "## Title" — attach them by page.
    const cont = getDb()
      .prepare("SELECT c.id, c.doc_id, c.page FROM knowledge_chunks c JOIN knowledge_docs k ON k.id = c.doc_id WHERE k.enabled = 1 AND c.content NOT LIKE '## %' ORDER BY c.seq")
      .all() as Array<{ id: number; doc_id: string; page: number }>
    for (const r of cont) byKey.get(`${r.doc_id}:${r.page}`)?.chunkIds.push(r.id)
    this.sections = [...byKey.values()]
    return this.sections
  }

  /** Sections whose title or alias is named in the query; the most specific phrase wins. */
  matchSections(query: string): Array<{ docId: string; docName: string; page: number; chunkIds: number[]; title: string }> {
    const q = normalize(query)
    const found: Array<{ section: ReturnType<KnowledgeLibrary['sectionIndex']>[number]; phrase: string }> = []
    for (const s of this.sectionIndex()) {
      let best = ''
      s.phrases.forEach((re, i) => {
        if (re.test(q) && s.phraseText[i].length > best.length) best = s.phraseText[i]
      })
      if (best) found.push({ section: s, phrase: best })
    }
    // Drop matches whose phrase is part of a longer matched phrase ("binary tree" inside "threaded binary tree").
    const specific = found.filter((f) => !found.some((g) => g !== f && g.phrase.length > f.phrase.length && g.phrase.includes(f.phrase)))
    return specific.sort((a, b) => b.phrase.length - a.phrase.length).slice(0, 3).map((f) => f.section)
  }

  /** Install or refresh a built-in reference document shipped with the app (one chunk group per "## " section). */
  async ensureBuiltin(id: string, name: string, file: string, version: number): Promise<void> {
    const d = getDb()
    const kind = `builtin:v${version}`
    const existing = d.prepare('SELECT kind, embedded, chunks FROM knowledge_docs WHERE id = ?').get(id) as { kind: string; embedded: number; chunks: number } | undefined
    if (existing && existing.kind === kind) {
      if (existing.embedded < existing.chunks) await this.embedDoc(id, name)
      return
    }
    let text: string
    try {
      text = await fsp.readFile(file, 'utf8')
    } catch {
      return // resource missing in this build
    }
    if (existing) this.remove(id)
    const sections = text.split(/^(?=## )/m).filter((s) => s.startsWith('## '))
    d.prepare('INSERT INTO knowledge_docs(id, name, kind, size, pages, chars, full_text, created_at) VALUES(?,?,?,?,?,?,?,?)').run(
      id, name, kind, Buffer.byteLength(text), sections.length, text.length, text, Date.now()
    )
    const insChunk = d.prepare('INSERT INTO knowledge_chunks(doc_id, seq, page, content) VALUES(?,?,?,?)')
    const insFts = d.prepare('INSERT INTO knowledge_fts(content, chunk_id) VALUES(?, ?)')
    let seq = 0
    d.transaction(() => {
      sections.forEach((sec, i) => {
        const title = sec.split('\n')[0].replace(/^##\s*/, '').trim()
        const parts = sec.length <= 3200 ? [sec.trim()] : chunkText(sec, 2400, 200).map((p, j) => (j === 0 ? p : `## ${title} (cont.)\n${p}`))
        for (const p of parts) {
          const r = insChunk.run(id, seq++, i + 1, p)
          insFts.run(p, Number(r.lastInsertRowid))
        }
      })
      d.prepare('UPDATE knowledge_docs SET chunks = ? WHERE id = ?').run(seq, id)
    })()
    this.invalidate()
    await this.embedDoc(id, name)
  }
  /** Hybrid retrieval: semantic similarity + keyword rank + "Unit N"/"Question N" sections, within a budget. */
  async search(query: string, budgetChars: number, opts: { sectionQuery?: string; explicit?: boolean } = {}): Promise<{ hits: KnowledgeHit[]; semantic: boolean }> {
    const explicit = opts.explicit ?? EXPLICIT_REF.test(query)
    const docs = this.activeDocs()
    if (!docs.length || !query.trim()) return { hits: [], semantic: false }
    const d = getDb()
    const docIds = new Set(docs.map((x) => x.id))
    const lists: number[][] = []
    const similarity = new Map<number, number>()

    // Keyword ranking.
    const q = ftsQuery(query)
    let keywordIds: number[] = []
    if (q) {
      try {
        keywordIds = (d.prepare('SELECT chunk_id FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts) LIMIT 30').all(q) as Array<{ chunk_id: number }>).map((r) => r.chunk_id)
      } catch {
        keywordIds = []
      }
    }

    // Semantic ranking.
    let semantic = false
    const vectors = this.loadVectors()
    if (vectors.size) {
      try {
        const [qv] = await this.ollama.embed(getSettings().roles.embedding, [QUERY_PREFIX + query.slice(0, 2000)])
        const qf = new Float32Array(qv)
        const scored = [...vectors.entries()].map(([id, v]) => [id, cosine(qf, v)] as const).sort((a, b) => b[1] - a[1])
        scored.forEach(([id, s]) => similarity.set(id, s))
        const kw = new Set(keywordIds)
        const passes = (id: number, s: number) => s >= (explicit ? SIM_EXPLICIT : kw.has(id) ? SIM_WITH_KEYWORD : SIM_ALONE)
        lists.push(scored.filter(([id, s]) => passes(id, s)).slice(0, 30).map(([id]) => id))
        semantic = true
      } catch {
        /* embedding model missing: keyword only */
      }
    }
    // Keyword hits count when semantics agree; without embeddings, only for explicit references (top 3 otherwise).
    lists.push(
      semantic
        ? keywordIds.filter((id) => (similarity.get(id) ?? 0) >= (explicit ? SIM_EXPLICIT : SIM_WITH_KEYWORD))
        : explicit
          ? keywordIds
          : keywordIds.slice(0, 3)
    )

    const fused = [...rrf(lists).entries()].sort((a, b) => b[1] - a[1])
    const chunkStmt = d.prepare('SELECT c.id, c.doc_id, c.page, c.content, k.name FROM knowledge_chunks c JOIN knowledge_docs k ON k.id = c.doc_id WHERE c.id = ?')
    const hits: KnowledgeHit[] = []
    let used = 0

    // A structure named in the request ("threaded binary tree", "circular queue") pulls in its whole section first.
    const CODE_INTENT = /\b(code|program|implement|write|function|c\+\+|java|python|\.c|\.h)\b/i
    const matched = this.matchSections(opts.sectionQuery ?? query)
    const taken = new Set<number>()
    const takeSection = (s: { docId: string; docName: string; page: number; chunkIds: number[] }) => {
      for (const cid of s.chunkIds) {
        const r = chunkStmt.get(cid) as { id: number; doc_id: string; page: number; content: string; name: string } | undefined
        if (!r || taken.has(r.id) || used + r.content.length > budgetChars) continue
        hits.push({ docId: r.doc_id, docName: r.name, page: r.page, content: r.content, score: 1, chunkId: r.id })
        taken.add(r.id)
        used += r.content.length
      }
    }
    for (const s of matched) takeSection(s)
    if (matched.some((s) => s.docId.startsWith('builtin-')) && CODE_INTENT.test(opts.sectionQuery ?? query)) {
      const rules = this.sectionIndex().find((s) => s.docId.startsWith('builtin-') && /^coding rules/i.test(s.title))
      if (rules) takeSection(rules)
    }

    // A "Unit 3" / "Question 2" request pulls in that whole section first.
    for (const doc of docs) {
      const full = (d.prepare('SELECT full_text FROM knowledge_docs WHERE id = ?').get(doc.id) as { full_text: string }).full_text
      const section = extractNumberedSection(full, opts.sectionQuery ?? query, Math.floor(budgetChars * 0.6))
      if (section && used + section.length <= budgetChars) {
        hits.push({ docId: doc.id, docName: doc.name, page: 0, content: section, score: 1, chunkId: -1 })
        used += section.length
        break
      }
    }
    for (const [id, score] of fused) {
      const r = chunkStmt.get(id) as { id: number; doc_id: string; page: number; content: string; name: string } | undefined
      if (!r || !docIds.has(r.doc_id)) continue
      if (taken.has(r.id)) continue
      if (hits.some((h) => h.chunkId === -1 && h.content.includes(r.content.slice(0, 120)))) continue
      if (used + r.content.length > budgetChars) continue
      hits.push({ docId: r.doc_id, docName: r.name, page: r.page, content: r.content, score: similarity.get(id) ?? score, chunkId: r.id })
      used += r.content.length
      if (hits.length >= 10) break
    }
    return { hits, semantic }
  }
}
