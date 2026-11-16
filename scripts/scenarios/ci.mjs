// CI check of a packaged app on a fresh machine (no Ollama): the window loads, SQLite
// works, an interactive terminal starts, code runs, and the built-in reference installs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export default async function ({ page, shot, S, log }) {
  const fail = (m) => {
    throw new Error(m)
  }
  const info = await S(() => window.api.app.info())
  log('app', info.version, 'electron', info.electron, info.platform)

  // SQLite (native module from app.asar.unpacked)
  const conv = await S(() => window.api.chat.create())
  if (!conv?.id) fail('could not create a conversation (SQLite)')
  log('sqlite: ok')

  // Interactive terminal (node-pty from app.asar.unpacked) — must produce output.
  const term = await S(() => window.api.terminal.create(80, 24))
  if (term.error) fail('terminal: ' + term.error)
  const echoed = await S(
    (id) =>
      new Promise((resolve) => {
        let out = ''
        const off = window.api.terminal.onData((tid, d) => {
          if (tid !== id) return
          out += d
          if (out.includes('pty-ok-42')) {
            off()
            resolve(true)
          }
        })
        setTimeout(() => window.api.terminal.write(id, 'echo pty-ok-$((40+2))\r'), 1500)
        setTimeout(() => resolve(false), 15000)
      }),
    term.id
  )
  if (!echoed) fail('terminal produced no output')
  await S((id) => window.api.terminal.kill(id), term.id)
  log('terminal (pty):', term.shell, 'ok')

  // Code execution
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-ci-'))
  fs.writeFileSync(path.join(ws, 'hello.js'), 'console.log("run-ok", 6 * 7)\n')
  await S((p) => window.__localcode.getState().openWorkspace(p), ws)
  await S((p) => window.__localcode.getState().runPath(p), path.join(fs.realpathSync(ws), 'hello.js'))
  await page.waitForFunction(() => {
    const s = window.__localcode.getState()
    return !s.runId && s.lastRun
  }, null, { timeout: 30000 })
  const run = await S(() => window.__localcode.getState().lastRun)
  if (run.status !== 'success' || !run.stdout.includes('run-ok 42')) fail('run failed: ' + JSON.stringify(run))
  log('run:', run.command, 'ok')

  // Runtime detection must not hang or crash
  const rts = await S(() => window.api.run.runtimes())
  log('runtimes:', rts.map((r) => `${r.label}=${r.available ? 'yes' : 'no'}`).join(', '))

  // Built-in DSA reference (keyword search works even without the embedding model)
  await page.waitForFunction(async () => (await window.api.knowledge.list()).some((d) => d.id === 'builtin-dsa' && d.chunks > 0), null, { timeout: 30000 })
  const hits = await S(() => window.api.knowledge.search('threaded binary tree'))
  if (!hits.hits.some((h) => /Threaded Binary Tree/.test(h.content))) fail('built-in reference search failed')
  log('knowledge: ok')

  // Setup wizard status works without Ollama
  const st = await S(() => window.api.setup.status())
  log('setup:', st.hardwareSummary, '| ollama running:', st.ollamaRunning, '| recommended:', st.recommendedProfile)
  await S(() => window.__localcode.getState().openSettings())
  await page.waitForTimeout(800)
  await shot('settings')
  log('CI CHECK PASSED')
}
