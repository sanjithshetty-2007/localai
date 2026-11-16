// Checks that each kind of request reaches the intended model role.
// E2E_ONLY=conversation,reasoning,code,vision,library (default: all)
import fs from 'node:fs'
import path from 'node:path'

const only = (process.env.E2E_ONLY ?? '').split(',').filter(Boolean)
const want = (k) => !only.length || only.includes(k)

async function ask(page, S, text, attach = []) {
  const before = await S(() => window.__localcode.getState().messages.length)
  if (attach.length) {
    const atts = await S((p) => window.api.attachments.addPaths(p), attach)
    await S((a) => window.__localcode.setState({ pendingAttachments: a }), atts)
  }
  const t0 = Date.now()
  await S((t) => window.__localcode.getState().sendMessage(t), text)
  await page.waitForFunction((n) => {
    const s = window.__localcode.getState()
    return !s.stream && s.messages.length >= n + 2
  }, before, { timeout: 900000, polling: 500 })
  const m = await S(() => window.__localcode.getState().messages.at(-1))
  m.seconds = ((Date.now() - t0) / 1000).toFixed(1)
  return m
}

const results = []
function check(name, m, expectModel, pattern) {
  const models = m.meta?.models ?? []
  const pass = !m.meta?.error && models.some((x) => x.startsWith(expectModel)) && pattern.test(m.content)
  results.push({ name, pass, models, seconds: m.seconds, route: m.meta?.route })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — route ${m.meta?.route}, ${models.join(' + ')}, ${m.seconds}s${m.meta?.thinking ? `, reasoning ${m.meta.thinking.length} chars` : ''}${m.meta?.error ? ' ERROR ' + m.meta.error : ''}\n      ${m.content.slice(0, 220).replace(/\s+/g, ' ')}`)
}

export default async function ({ page, shot, S, outDir }) {
  await page.waitForFunction(() => window.__localcode.getState().ollama?.connected, null, { timeout: 30000 })
  const roles = await S(() => window.__localcode.getState().settings.roles)
  console.log('roles:', JSON.stringify(roles))
  await S(() => window.__localcode.getState().newConversation())

  if (want('conversation')) {
    const m = await ask(page, S, 'What are three good habits for studying effectively? Keep it short.')
    check('conversation → qwen3:8b', m, 'qwen3:8b', /\w{3,}/)
    await shot('conversation')
  }
  if (want('reasoning')) {
    const m = await ask(page, S, 'Solve step by step: with FIFO page replacement and 3 frames, how many page faults occur for the reference string 7 0 1 2 0 3 0 4?')
    check('reasoning → deepseek-r1:8b', m, 'deepseek-r1:8b', /\b7\b/)
    await shot('reasoning')
  }
  if (want('code')) {
    const m = await ask(page, S, 'Write a Python function fib(n) in fib.py that returns the nth Fibonacci number iteratively.')
    check('code → qwen2.5-coder:7b', m, 'qwen2.5-coder:7b', /def fib/)
  }
  if (want('vision')) {
    const img = path.join(outDir, 'execution-python-error.png')
    if (fs.existsSync(img)) {
      const m = await ask(page, S, 'What error is shown in this screenshot and how do I fix it?', [img])
      check('vision → qwen2.5vl:7b', m, 'qwen2.5vl:7b', /value|NameError/i)
      await shot('vision')
    }
  }
  fs.writeFileSync(path.join(outDir, 'roles-results.json'), JSON.stringify(results, null, 2))
}
