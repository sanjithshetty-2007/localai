// Acceptance tests that need a real Ollama model: general chat, code generation,
// execution, self-healing fix, follow-up continuity, PDF, ZIP, screenshot, multi-file app.
// Run a subset with E2E_ONLY=chat,code,... (default: all).
import fs from 'node:fs'
import path from 'node:path'

const only = (process.env.E2E_ONLY ?? '').split(',').filter(Boolean)
const want = (k) => !only.length || only.includes(k)

async function send(page, S, text, { attach = [], kind = 'chat', timeout = 600000 } = {}) {
  const before = await S(() => window.__localcode.getState().messages.length)
  if (attach.length) {
    const atts = await S((p) => window.api.attachments.addPaths(p), attach)
    await S((a) => window.__localcode.setState({ pendingAttachments: a }), atts)
  }
  if (kind === 'fix') await S(() => window.__localcode.getState().fixWithAI())
  else await S((t) => window.__localcode.getState().sendMessage(t), text)
  const t0 = Date.now()
  await page.waitForFunction(
    (n) => {
      const s = window.__localcode.getState()
      return !s.stream && s.messages.length >= n + 2
    },
    before,
    { timeout, polling: 500 }
  )
  const res = await S(() => {
    const s = window.__localcode.getState()
    const m = s.messages[s.messages.length - 1]
    return { content: m.content, meta: m.meta, model: m.model, changeSet: m.meta?.changeSetId ? s.changeSets[m.meta.changeSetId] : null }
  })
  res.seconds = ((Date.now() - t0) / 1000).toFixed(1)
  if (res.meta?.error) throw new Error('Assistant error: ' + res.meta.error)
  return res
}

async function runAndWait(page, S, file) {
  await S((p) => window.__localcode.getState().runPath(p), file)
  await page.waitForFunction((p) => {
    const s = window.__localcode.getState()
    return !s.runId && s.lastRun && s.lastRun.file.toLowerCase() === p.toLowerCase()
  }, file, { timeout: 60000 })
  return S(() => window.__localcode.getState().lastRun)
}

const summary = []
const record = (name, pass, detail) => {
  summary.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

export default async function ({ page, shot, S, workspace, outDir, log }) {
  await page.waitForFunction(() => window.__localcode.getState().ollama?.connected, null, { timeout: 30000 })
  await S(() => window.__localcode.getState().newConversation())

  if (want('chat')) {
    const r = await send(page, S, 'In two sentences: what is the difference between a process and a thread?')
    record('1 general chat', r.content.length > 40 && /thread/i.test(r.content), `${r.model}, ${r.seconds}s, route ${r.meta?.route}: ${r.content.slice(0, 120).replace(/\n/g, ' ')}`)
    await shot('chat')
  }

  let primes = path.join(workspace, 'primes.py')
  if (want('code')) {
    const r = await send(page, S, 'Write a Python program primes.py that prints all prime numbers below 50.')
    const cs = r.changeSet
    const item = cs?.items.find((i) => i.action.type === 'create_file' || i.action.type === 'edit_file')
    record('2a code generation → change set', !!item, item ? `${item.action.type} ${item.action.path} (+${item.added})` : `no change set; reply: ${r.content.slice(0, 200)}`)
    await shot('code-proposed')
    if (item) {
      primes = path.join(workspace, item.action.path)
      await S((id) => window.__localcode.getState().applyChanges(id), cs.id)
      await page.waitForTimeout(800)
      const open = await S((p) => window.__localcode.getState().tabs.some((t) => t.kind === 'file' && t.path.toLowerCase() === p.toLowerCase()), primes)
      record('2b accept → file written and open in Monaco', fs.existsSync(primes) && open, primes)
      await shot('code-applied')
      const run = await runAndWait(page, S, primes)
      record('3 execute generated program', run.status === 'success' && /\b47\b/.test(run.stdout), `exit ${run.exitCode}: ${run.stdout.slice(0, 120).replace(/\s+/g, ' ')}`)
      await shot('code-run')
    }
  }

  if (want('fix')) {
    const bad = path.join(workspace, 'stats.py')
    fs.writeFileSync(bad, 'def mean(values):\n    return sum(values) / len(values)\n\nnumbers = [4, 8, 15, 16, 23, 42]\nprint("mean:", mean(number))\n')
    await S((p) => window.__localcode.getState().openFile(p), bad)
    await page.waitForTimeout(300)
    const run1 = await runAndWait(page, S, bad)
    record('4a error captured', run1.status === 'error' && run1.problems.length > 0, `line ${run1.problems[0]?.line}: ${run1.problems[0]?.message}`)
    const r = await send(page, S, '', { kind: 'fix' })
    const cs = r.changeSet
    const item = cs?.items.find((i) => i.action.path?.toLowerCase() === 'stats.py')
    record('4b AI proposes a patch', !!item, item ? `+${item.added} −${item.removed}; ${r.seconds}s` : r.content.slice(0, 200))
    await shot('fix-proposed')
    if (cs) {
      await S(([id, f]) => window.__localcode.getState().applyAndRun(id, f), [cs.id, bad])
      await page.waitForFunction((id) => ['passed', 'failed'].includes(window.__localcode.getState().verifications[id]?.status), cs.id, { timeout: 60000 })
      const v = await S((id) => window.__localcode.getState().verifications[id], cs.id)
      record('4c accept & re-run verifies the fix', v.status === 'passed', JSON.stringify(v))
      await shot('fix-verified')
    }
  }

  if (want('followup')) {
    const r = await send(page, S, 'In the stats file you just fixed, what was the bug, in one sentence?')
    record('9 follow-up continuity', /number|NameError|variable|name/i.test(r.content), r.content.slice(0, 160).replace(/\n/g, ' '))
  }

  if (want('pdf')) {
    await S(() => window.__localcode.getState().newConversation())
    const r = await send(page, S, 'Solve question 2 from this assignment. Write the solution to palindrome.py.', { attach: [path.join(outDir, 'assignment.pdf')] })
    const item = r.changeSet?.items[0]
    record('6 PDF question extraction + solution', /palindrome/i.test(r.content) && !!item, `${item ? item.action.path : 'no file'}; steps: ${(r.meta?.steps ?? []).join(' | ').slice(0, 160)}`)
    await shot('pdf')
    if (item) {
      await S((id) => window.__localcode.getState().applyChanges(id), r.changeSet.id)
      const run = await runAndWait(page, S, path.join(workspace, item.action.path))
      log('palindrome run:', run.status, run.stdout.slice(0, 200), run.stderr.slice(0, 200))
    }
  }

  if (want('zip')) {
    await S(() => window.__localcode.getState().newConversation())
    const r = await send(page, S, 'I attached a project ZIP. What web framework does it use and what does its route return?', { attach: [path.join(outDir, 'project.zip')] })
    record('7 ZIP extracted, indexed, answered', /flask/i.test(r.content), r.content.slice(0, 160).replace(/\n/g, ' '))
    await shot('zip')
  }

  if (want('vision')) {
    await S(() => window.__localcode.getState().newConversation())
    const img = path.join(outDir, 'execution-python-error.png')
    if (fs.existsSync(img)) {
      const r = await send(page, S, 'This is a screenshot of my IDE. What error is shown and how do I fix it?', { attach: [img] })
      record('5 screenshot analysis', /value|NameError|len/i.test(r.content), `${(r.meta?.models ?? []).join(' + ')}, ${r.seconds}s: ${r.content.slice(0, 160).replace(/\n/g, ' ')}`)
      await shot('vision')
    } else record('5 screenshot analysis', false, 'run the execution scenario first to create the screenshot')
  }

  if (want('app')) {
    await S(() => window.__localcode.getState().newConversation())
    const r = await send(page, S, 'Build a complete task management application in a folder named taskapp using Python Flask, HTML, CSS, JavaScript and SQLite. Include app.py, templates/index.html, static/style.css, static/app.js, requirements.txt and README.md.', { timeout: 900000 })
    const files = (r.changeSet?.items ?? []).map((i) => i.action.path).filter(Boolean)
    record('8a multi-file project proposed', files.length >= 4, `${files.length} files: ${files.join(', ')} (${r.seconds}s)`)
    if (r.changeSet) {
      await S((id) => window.__localcode.getState().applyChanges(id), r.changeSet.id)
      const written = files.filter((f) => fs.existsSync(path.join(workspace, f)))
      record('8b files actually written', written.length === files.length, `${written.length}/${files.length}`)
      await page.waitForTimeout(800)
      await shot('app')
    }
  }

  fs.writeFileSync(path.join(outDir, 'ai-results.json'), JSON.stringify(summary, null, 2))
  const failed = summary.filter((s) => !s.pass)
  log(`\n${summary.length - failed.length}/${summary.length} checks passed`)
}
