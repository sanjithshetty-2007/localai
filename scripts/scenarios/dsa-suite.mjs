// Runs the DSA/LeetCode suite through the full app pipeline and grades every answer.
// Offline check: no renderer network requests are allowed, and automatic updates are off.
// E2E_ONLY=lc84,avl (default: all)   E2E_TAG=run name
import fs from 'node:fs'
import path from 'node:path'
import { PROBLEMS, grade } from '../dsa-suite/problems.mjs'

export default async function ({ page, S, outDir, log }) {
  const only = (process.env.E2E_ONLY ?? '').split(',').filter(Boolean)
  const tag = process.env.E2E_TAG ?? 'suite'
  const requests = []
  page.on('request', (r) => requests.push(r.url()))
  await page.waitForFunction(() => window.__localcode.getState().ollama?.connected, null, { timeout: 30000 })
  await S(() => window.__localcode.setState({ setupOpen: false }))
  // Test profile: no update checks; code testing enabled (an opt-in setting, off by default for users).
  await S(() => window.__localcode.getState().updateSettings({ autoUpdate: false, testCode: true, doubleCheck: true }))
  const roles = await S(() => window.__localcode.getState().settings.roles)
  log('roles:', JSON.stringify(roles))
  const results = []
  for (const p of PROBLEMS.filter((x) => !only.length || only.includes(x.id))) {
    await S(() => window.__localcode.getState().newConversation())
    const t0 = Date.now()
    await S((q) => window.__localcode.getState().sendMessage(q), p.q)
    await page.waitForFunction(() => {
      const s = window.__localcode.getState()
      return !s.stream && s.messages.length >= 2
    }, null, { timeout: 1800000, polling: 1000 })
    const m = await S(() => window.__localcode.getState().messages.at(-1))
    const g = m.meta?.error ? { pass: false, detail: 'ERROR: ' + m.meta.error } : grade(p, m.content)
    const r = { id: p.id, pass: g.pass, detail: g.detail, secs: Math.round((Date.now() - t0) / 1000), route: m.meta?.route, models: m.meta?.models ?? [], steps: (m.meta?.steps ?? []).filter((s) => !s.startsWith('Library') && !s.startsWith('Context')) }
    results.push(r)
    fs.writeFileSync(path.join(outDir, `${tag}-${p.id}.md`), m.content + (m.meta?.thinking ? `\n\n<!-- reasoning ${m.meta.thinking.length} chars -->` : ''))
    log(`${g.pass ? 'PASS' : 'FAIL'}  ${p.id.padEnd(9)} ${String(r.secs).padStart(4)}s  ${(r.route ?? '').padEnd(9)} ${r.models.join('+').padEnd(40)} ${g.detail}`)
    if (r.steps.length) log('        ' + r.steps.join(' | ').slice(0, 260))
    fs.writeFileSync(path.join(outDir, `${tag}-results.json`), JSON.stringify(results, null, 2))
  }
  const external = requests.filter((u) => !/^(file|devtools|data|blob):/.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u))
  const passed = results.filter((r) => r.pass).length
  log(`\nSUMMARY ${passed}/${results.length} passed · external network requests from the app window: ${external.length}`)
}
