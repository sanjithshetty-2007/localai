// Knowledge library: upload a syllabus, embed it with the embedding model, retrieve, and answer from it.
import path from 'node:path'

async function ask(page, S, text) {
  const before = await S(() => window.__localcode.getState().messages.length)
  await S((t) => window.__localcode.getState().sendMessage(t), text)
  await page.waitForFunction((n) => {
    const s = window.__localcode.getState()
    return !s.stream && s.messages.length >= n + 2
  }, before, { timeout: 600000, polling: 500 })
  return S(() => window.__localcode.getState().messages.at(-1))
}

export default async function ({ page, shot, S, outDir, log }) {
  // Clean library for a repeatable run.
  for (const d of await S(() => window.api.knowledge.list())) await S((id) => window.api.knowledge.remove(id), d.id)

  const t0 = Date.now()
  const r = await S((p) => window.api.knowledge.add(p), [path.join(outDir, 'syllabus.pdf')])
  log('added:', JSON.stringify(r.added.map((d) => ({ name: d.name, pages: d.pages, chunks: d.chunks, embedded: d.embedded, model: d.embedModel, error: d.error }))), 'errors:', JSON.stringify(r.errors), `${Date.now() - t0} ms`)
  const doc = r.added[0]
  if (!doc || doc.embedded < doc.chunks) throw new Error('Syllabus was not fully embedded')

  await S(() => window.__localcode.getState().loadKnowledge())
  await S(() => window.__localcode.setState({ view: 'knowledge', sidebarVisible: true }))
  const s = await S(() => window.api.knowledge.search('which page replacement algorithms do we study'))
  log('retrieval:', s.semantic ? 'semantic' : 'keyword', JSON.stringify(s.hits.map((h) => ({ page: h.page, score: +h.score.toFixed(3), text: h.content.slice(0, 70) }))))
  if (!s.hits.some((h) => /LRU/.test(h.content))) throw new Error('Retrieval missed the page replacement passage')
  const u = await S(() => window.api.knowledge.search('topics in unit 3'))
  log('unit 3 section:', JSON.stringify(u.hits[0]?.content.slice(0, 120)))
  await page.waitForTimeout(400)
  await shot('library')

  await S(() => window.__localcode.getState().newConversation())
  const m1 = await ask(page, S, 'According to my syllabus, what topics are covered in Unit 3, and how many marks is the end-semester exam?')
  log('answer:', m1.model, '|', m1.content.slice(0, 400).replace(/\n/g, ' '))
  log('steps:', (m1.meta?.steps ?? []).join(' | '))
  const ok = /paging|page replacement|LRU|virtual memory/i.test(m1.content) && /50/.test(m1.content)
  log(ok ? 'PASS syllabus-grounded answer' : 'FAIL syllabus-grounded answer')
  await shot('answer')

  const libSteps = (m) => (m.meta?.steps ?? []).filter((x) => x.startsWith('Library')).join(' | ')
  const m2 = await ask(page, S, 'Write a tiny Python function that adds two numbers.')
  log('unrelated request → library:', libSteps(m2) || 'none')
  const m3 = await ask(page, S, 'Explain round robin scheduling with a short example.')
  log('related request (no "syllabus" word) → library:', libSteps(m3) || 'none')
  await shot('related')
  if (!ok) throw new Error('Answer did not use the syllabus')
  if (libSteps(m2)) throw new Error('Unrelated request pulled syllabus passages')
  if (!libSteps(m3)) throw new Error('Related request did not use the syllabus')
}
