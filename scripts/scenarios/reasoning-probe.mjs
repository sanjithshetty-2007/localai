// Ask one question through the full app pipeline and save the answer + reasoning for analysis.
// E2E_QUESTION="..."  E2E_TAG=name
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ page, S, outDir, log }) {
  const q = process.env.E2E_QUESTION
  const tag = process.env.E2E_TAG ?? 'probe'
  await page.waitForFunction(() => window.__localcode.getState().ollama?.connected, null, { timeout: 30000 })
  await S(() => window.__localcode.setState({ setupOpen: false }))
  await S(() => window.__localcode.getState().newConversation())
  const t0 = Date.now()
  await S((t) => window.__localcode.getState().sendMessage(t), q)
  await page.waitForFunction(() => {
    const s = window.__localcode.getState()
    return !s.stream && s.messages.length >= 2
  }, null, { timeout: 900000, polling: 1000 })
  const m = await S(() => window.__localcode.getState().messages.at(-1))
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  fs.writeFileSync(path.join(outDir, `${tag}-answer.md`), m.content)
  fs.writeFileSync(path.join(outDir, `${tag}-thinking.txt`), m.meta?.thinking ?? '')
  fs.writeFileSync(path.join(outDir, `${tag}-meta.json`), JSON.stringify({ secs, model: m.model, meta: { ...m.meta, thinking: undefined } }, null, 2))
  log(`${tag}: ${secs}s, route ${m.meta?.route}, models ${(m.meta?.models ?? []).join('+')}, answer ${m.content.length} chars, reasoning ${(m.meta?.thinking ?? '').length} chars`)
  log('steps:', (m.meta?.steps ?? []).join(' | '))
}
