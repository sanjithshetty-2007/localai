import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chunkText, cosine, docxXmlToText, extractNumberedSection, rrf, slidePassages, RepetitionMonitor } from '../electron/services/text-utils'

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

describe('reasoning loop detection', () => {
  const feed = (m: RepetitionMonitor, text: string) => {
    let fired = false
    for (let i = 0; i < text.length; i += 37) fired = m.push(text.slice(i, i + 37)) || fired
    return fired
  }
  it('does not fire on varied reasoning', () => {
    const varied = Array.from({ length: 400 }, (_, i) => `Step ${i}: consider node ${i * 7} with depth ${i % 13} and value ${(i * 31) % 97}.`).join(' ')
    expect(feed(new RepetitionMonitor(), varied)).toBe(false)
  })
  it('fires when the same paragraph keeps repeating', () => {
    const intro = Array.from({ length: 60 }, (_, i) => `Fresh idea ${i} about subtree ${i * 3}.`).join(' ')
    const para = 'We start the BFS from the target node and enqueue its left child, right child and parent, marking each as visited so we never go back. '
    expect(feed(new RepetitionMonitor(), intro + para.repeat(60))).toBe(true)
  })
  it('does not fire on real deepseek-r1 reasoning that restates (LeetCode 863, 7-42% overlap)', () => {
    const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'r1-lc863-thinking.txt'), 'utf8')
    expect(feed(new RepetitionMonitor(), real)).toBe(false)
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
