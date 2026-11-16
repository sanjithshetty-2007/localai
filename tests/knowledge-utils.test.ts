import { describe, expect, it } from 'vitest'
import { chunkText, cosine, docxXmlToText, extractNumberedSection, rrf, slidePassages } from '../electron/services/text-utils'

const syllabus = `CS301 Operating Systems — Syllabus
Unit I: Introduction
OS structure, system calls, processes.
Unit II: CPU Scheduling
FCFS, SJF, Round Robin, priority scheduling.
Unit III: Memory Management
Paging, segmentation, virtual memory, page replacement (FIFO, LRU, Optimal).
Unit IV: File Systems
Allocation methods, directory structure.`

describe('syllabus sections', () => {
  it('finds "unit 3" written as Unit III', () => {
    const s = extractNumberedSection(syllabus, 'what topics are in unit 3?', 2000)!
    expect(s).toContain('Memory Management')
    expect(s).toContain('LRU')
    expect(s).not.toContain('File Systems')
  })
  it('accepts Roman numerals in the question too', () => {
    expect(extractNumberedSection(syllabus, 'explain Unit II', 2000)).toContain('Round Robin')
  })
  it('handles "Module 2:" headings', () => {
    const doc = 'Module 1: Basics\nintro\nModule 2: Trees\nBST, AVL\nModule 3: Graphs\nBFS'
    expect(extractNumberedSection(doc, 'module 2 questions', 500)).toBe('Module 2: Trees\nBST, AVL')
  })
})

describe('slide decks', () => {
  it('drops repeated header lines and merges short slides with page markers', () => {
    const pages = Array.from({ length: 10 }, (_, i) => `Data structures and its applications 18/09/2026 .\nSlide ${i + 1} title\nPoint about topic ${i + 1}.`)
    const { cleaned, passages } = slidePassages(pages, 120)
    expect(cleaned[0]).toBe('Slide 1 title\nPoint about topic 1.')
    expect(cleaned.every((c) => !c.includes('18/09/2026'))).toBe(true)
    expect(passages.length).toBeLessThan(10)
    expect(passages[0].page).toBe(1)
    expect(passages[1].text.startsWith(`[p.${passages[1].page}]`)).toBe(true)
  })
})

describe('chunking and ranking', () => {
  it('keeps short text as one chunk and splits long text with overlap', () => {
    expect(chunkText('short text')).toEqual(['short text'])
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about topic ${i % 7}.`).join(' ')
    const chunks = chunkText(long, 400, 80)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every((c) => c.length <= 400)).toBe(true)
    // consecutive chunks overlap
    expect(chunks[1].slice(0, 20).length).toBeGreaterThan(0)
    expect(long.includes(chunks[1].slice(0, 30))).toBe(true)
  })
  it('computes cosine similarity', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1)
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0)
  })
  it('fuses rankings so items ranked well in both lists win', () => {
    const s = rrf([
      [1, 2, 3],
      [3, 1, 4]
    ])
    const order = [...s.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    expect(order[0]).toBe(1)
    expect(order).toContain(4)
  })
  it('extracts text from DOCX XML', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Unit I</w:t></w:r></w:p><w:p><w:r><w:t>A &amp; B</w:t><w:tab/><w:t>x</w:t></w:r></w:p></w:body></w:document>'
    expect(docxXmlToText(xml)).toBe('Unit I\nA & B\tx')
  })
})
