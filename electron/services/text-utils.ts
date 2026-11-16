const STOP = new Set('the a an and or of to in is it for on with this that be are was what how why can you me my i please explain write code from into about do does give'.split(' '))

export function ftsQuery(text: string): string | null {
  const words = [...new Set((text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 24)
  if (!words.length) return null
  return words.map((w) => `"${w}"`).join(' OR ')
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']
const QUESTION_WORDS = 'question|q|problem|exercise|task|part'
const SECTION_WORDS = 'unit|module|chapter|week|lecture|lab|topic|section'

function fromRoman(s: string): number {
  const i = ROMAN.indexOf(s.toUpperCase())
  return i > 0 ? i : NaN
}

/**
 * Find the section of a document the query points at: "Question 2", "Q3", "Unit III",
 * "Module 2", "Chapter 4"… The document is searched with the same family of words the
 * user used (question-like or syllabus-like), accepting Arabic or Roman numerals.
 */
export function extractNumberedSection(full: string, query: string, maxChars: number): string | null {
  const m = new RegExp(`\\b(${QUESTION_WORDS}|${SECTION_WORDS})\\s*\\.?\\s*#?\\s*(\\d+|[ivxIVX]+)\\b`, 'i').exec(query)
  if (!m) return null
  const n = /^\d+$/.test(m[2]) ? Number(m[2]) : fromRoman(m[2])
  if (!Number.isFinite(n) || n < 1) return null
  const words = new RegExp(`^(${SECTION_WORDS})$`, 'i').test(m[1]) ? SECTION_WORDS : QUESTION_WORDS
  const num = (k: number) => `(?:${k}${ROMAN[k] ? '|' + ROMAN[k] : ''})`
  const head = (k: number) => `(?:(?:${words})\\s*[.:\\-–]?\\s*#?\\s*${num(k)}\\b|${k}\\s*[.)]\\s+\\S)`
  const sm = new RegExp(`(^|\\n)\\s*${head(n)}`, 'i').exec(full)
  if (!sm) return null
  const start = sm.index
  const rest = full.slice(start + 1)
  const nm = new RegExp(`\\n\\s*${head(n + 1)}`, 'i').exec(rest)
  const end = nm ? start + 1 + nm.index : Math.min(full.length, start + maxChars)
  return full.slice(start, Math.min(end, start + maxChars)).trim()
}

/** Split text into overlapping chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const chunks: string[] = []
  let pos = 0
  while (pos < clean.length) {
    let end = Math.min(clean.length, pos + size)
    if (end < clean.length) {
      const window = clean.slice(pos + Math.floor(size * 0.5), end)
      const para = window.lastIndexOf('\n\n')
      const sent = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'))
      const cut = para >= 0 ? para : sent
      if (cut >= 0) end = pos + Math.floor(size * 0.5) + cut + 1
    }
    const piece = clean.slice(pos, end).trim()
    if (piece) chunks.push(piece)
    if (end >= clean.length) break
    pos = Math.max(end - overlap, pos + 1)
  }
  return chunks
}

/**
 * Prepare slide-deck style PDF pages: drop header/footer lines repeated on many pages
 * (course title, dates, page furniture) and merge consecutive short pages into passages
 * of a useful size. Each passage keeps "[p.N]" markers so citations stay accurate.
 */
export function slidePassages(pages: string[], target = 1400): { cleaned: string[]; passages: Array<{ page: number; text: string }> } {
  const norm = (l: string) => l.replace(/\s+/g, ' ').trim()
  const counts = new Map<string, number>()
  for (const p of pages) for (const l of new Set(p.split('\n').map(norm).filter((l) => l.length > 3))) counts.set(l, (counts.get(l) ?? 0) + 1)
  const minRepeat = Math.max(4, Math.floor(pages.length * 0.2))
  const boiler = new Set([...counts.entries()].filter(([, n]) => n >= minRepeat).map(([l]) => l))
  // Phrases repeated inside lines (e.g. "Data structures and its applications 18/09/2026 .")
  const cleaned = pages.map((p) =>
    p
      .split('\n')
      .map(norm)
      .filter((l) => l && !boiler.has(l))
      .join('\n')
      .trim()
  )
  const passages: Array<{ page: number; text: string }> = []
  let buf = ''
  let start = 1
  cleaned.forEach((text, i) => {
    if (!text) return
    const piece = `[p.${i + 1}] ${text}`
    if (buf && buf.length + piece.length > target) {
      passages.push({ page: start, text: buf })
      buf = ''
    }
    if (!buf) start = i + 1
    buf = buf ? `${buf}\n\n${piece}` : piece
    if (buf.length > target * 1.6) {
      for (const c of chunkText(buf, target, 150)) passages.push({ page: start, text: c })
      buf = ''
    }
  })
  if (buf) passages.push({ page: start, text: buf })
  return { cleaned, passages }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Reciprocal rank fusion of several ranked id lists. */
export function rrf(lists: Array<Array<number>>, k = 60): Map<number, number> {
  const scores = new Map<number, number>()
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)))
  return scores
}

/** Plain text from a .docx document.xml body. */
export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
