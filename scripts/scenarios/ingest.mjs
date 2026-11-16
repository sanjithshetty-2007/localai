// Add a document to the library of whichever profile the app was launched with, then probe retrieval.
// E2E_DOC=<path to pdf>  E2E_QUERIES="q1|q2"
import path from 'node:path'

export default async function ({ page, S, log }) {
  const doc = process.env.E2E_DOC
  const name = path.basename(doc)
  // Wait for the built-in reference to finish installing/embedding.
  await page.waitForFunction(async () => {
    const docs = await window.api.knowledge.list()
    const b = docs.find((d) => d.id === 'builtin-dsa')
    return b && b.embedded >= b.chunks
  }, null, { timeout: 180000, polling: 2000 }).catch(() => log('built-in reference not fully embedded yet'))
  for (const d of await S(() => window.api.knowledge.list())) if (d.name === name) await S((id) => window.api.knowledge.remove(id), d.id)
  const t0 = Date.now()
  const r = await S((p) => window.api.knowledge.add([p]), doc)
  if (r.errors.length) throw new Error(r.errors.join('; '))
  const d = r.added[0]
  log(`added "${d.name}": ${d.pages} pages → ${d.chunks} passages, ${d.embedded} embedded with ${d.embedModel} in ${((Date.now() - t0) / 1000).toFixed(0)}s${d.error ? ' — ' + d.error : ''}`)
  const docs = await S(() => window.api.knowledge.list())
  log('library:', docs.map((x) => `${x.name} (${x.chunks} passages${x.enabled ? '' : ', off'})`).join(' · '))
  for (const q of (process.env.E2E_QUERIES ?? '').split('|').filter(Boolean)) {
    const s = await S((qq) => window.api.knowledge.search(qq), q)
    log(`\nQ: ${q}  [${s.semantic ? 'semantic' : 'keyword'}]`)
    for (const h of s.hits.slice(0, 4)) log(`   ${h.docName.slice(0, 28)} p.${h.page || 'section'} (${h.score.toFixed(2)}): ${h.content.replace(/\s+/g, ' ').slice(0, 110)}`)
  }
}
