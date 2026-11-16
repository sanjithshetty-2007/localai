// Test 11 (packaged build) + Test 10 (no cloud requests): run with E2E_EXE pointing at the built .exe.
import path from 'node:path'

export default async function ({ page, app, shot, S, workspace, log }) {
  const requests = []
  page.on('request', (r) => requests.push(r.url()))
  const info = await S(() => window.api.app.info())
  log('packaged app:', info.version, 'electron', info.electron, 'db', info.dbPath)

  // SQLite (native module from app.asar.unpacked) works if conversations load.
  const convs = await S(() => window.api.chat.list())
  log('conversations in DB:', convs.length)

  // Interactive terminal (node-pty from app.asar.unpacked).
  const term = await S(() => window.api.terminal.create(80, 24))
  log('pty:', JSON.stringify(term))
  if (term.error) throw new Error('PTY failed in packaged app')
  await S((id) => window.api.terminal.kill(id), term.id)

  // Execution.
  await S((p) => window.__localcode.getState().runPath(p), path.join(workspace, 'hello.py'))
  await page.waitForFunction(() => {
    const s = window.__localcode.getState()
    return !s.runId && s.lastRun
  }, null, { timeout: 30000 })
  const run = await S(() => window.__localcode.getState().lastRun)
  log('run:', run.status, JSON.stringify(run.stdout))

  // A real local AI answer.
  await page.waitForFunction(() => window.__localcode.getState().ollama?.connected, null, { timeout: 20000 })
  await S(() => window.__localcode.getState().newConversation())
  await S(() => window.__localcode.getState().sendMessage('Reply with one short sentence: what does hello.py print?'))
  await page.waitForFunction(() => {
    const s = window.__localcode.getState()
    return !s.stream && s.messages.length >= 2
  }, null, { timeout: 300000, polling: 500 })
  const m = await S(() => window.__localcode.getState().messages.at(-1))
  log('assistant:', m.meta?.error ?? m.content.slice(0, 200))
  await shot('chat')

  // Main-process network: Ollama status reports the URL it talks to.
  const status = await S(() => window.api.ollama.status())
  log('ollama url:', status.url, 'connected', status.connected)
  const external = requests.filter((u) => !/^(file|devtools|data|blob):/.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u))
  log('renderer requests:', requests.length, 'external:', external.length ? external.join(', ') : 'none')
  if (external.length) throw new Error('External network requests detected')
  void app
}
