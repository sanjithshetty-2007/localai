// DSA answer quality: the two requests that failed for the user, checked for the defining operations.
async function ask(page, S, text) {
  const before = await S(() => window.__localcode.getState().messages.length)
  const t0 = Date.now()
  await S((t) => window.__localcode.getState().sendMessage(t), text)
  await page.waitForFunction((n) => {
    const s = window.__localcode.getState()
    return !s.stream && s.messages.length >= n + 2
  }, before, { timeout: 900000, polling: 500 })
  const m = await S(() => window.__localcode.getState().messages.at(-1))
  m.seconds = ((Date.now() - t0) / 1000).toFixed(0)
  return m
}

const CASES = [
  {
    q: 'give code for expression tree in .c and .h',
    must: [/postfix/i, /push|stack/i, /evaluat/i, /inorder|in-order/i],
    wrong: [/insertLeft|insertRight/]
  },
  {
    q: 'write a threaded binary tree program in C',
    must: [/thread/i, /(lthread|rthread|isThreaded|leftThread|rightThread)/i, /inorder|in-order/i, /successor/i],
    wrong: []
  }
]

export default async function ({ page, shot, S, log }) {
  await page.waitForFunction(() => window.__localcode.getState().ollama?.connected, null, { timeout: 30000 })
  const roles = await S(() => window.__localcode.getState().settings.roles)
  log('coder:', roles.coder)
  for (const [i, c] of CASES.entries()) {
    await S(() => window.__localcode.getState().newConversation())
    const m = await ask(page, S, c.q)
    const missing = c.must.filter((re) => !re.test(m.content)).map(String)
    const wrong = c.wrong.filter((re) => re.test(m.content)).map(String)
    const files = (await S((id) => window.__localcode.getState().changeSets[id], m.meta?.changeSetId))?.items.map((x) => x.action.path) ?? []
    log(`${missing.length || wrong.length ? 'FAIL' : 'PASS'}  "${c.q}" — ${(m.meta?.models ?? []).join('+')}, ${m.seconds}s, files: ${files.join(', ') || 'none'}`)
    log('      steps:', (m.meta?.steps ?? []).join(' | ').slice(0, 300))
    if (missing.length) log('      missing:', missing.join(' '))
    if (wrong.length) log('      wrong structure:', wrong.join(' '))
    await shot(`case${i + 1}`)
  }
}
