// End-to-end driver: launches the built app with Playwright's Electron support,
// runs a named scenario and saves screenshots. Usage:
//   node scripts/e2e.mjs <scenario> [workspaceDir]
// Requires `npm run build` (or electron-vite build) first.
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scenario = process.argv[2] ?? 'smoke'
const workspace = process.argv[3]
const outDir = process.env.E2E_OUT ?? path.join(os.tmpdir(), 'localcode-e2e')
fs.mkdirSync(outDir, { recursive: true })
const userData = process.env.E2E_USER_DATA ?? path.join(outDir, 'profile')

const exe = process.env.E2E_EXE // test a packaged build, e.g. release/1.0.0/win-unpacked/LocalCode AI Studio.exe
const app = await electron.launch({
  ...(exe ? { executablePath: exe, args: [] } : { args: [root] }),
  cwd: root,
  env: { ...process.env, LOCALCODE_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }
})
const page = await app.firstWindow()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
await page.waitForFunction(() => window.__localcode?.getState().ready, null, { timeout: 30000 })

const shot = async (name) => {
  const p = path.join(outDir, `${scenario}-${name}.png`)
  await page.screenshot({ path: p })
  console.log('screenshot', p)
}
const state = () => page.evaluate(() => {
  const s = window.__localcode.getState()
  return { workspace: s.workspace, tabs: s.tabs.map((t) => t.id), messages: s.messages.length, stream: !!s.stream, lastRun: s.lastRun, ollama: s.ollama?.connected }
})
const S = (fn, arg) => page.evaluate(fn, arg)

try {
  if (workspace) {
    await S((ws) => window.__localcode.getState().openWorkspace(ws), workspace)
    await page.waitForTimeout(800)
  }
  const mod = await import(path.join(root, 'scripts', 'scenarios', `${scenario}.mjs`).replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'))
  await mod.default({ page, app, shot, state, S, workspace, outDir, log: (...a) => console.log(...a) })
} catch (e) {
  console.error('SCENARIO FAILED:', e)
  await shot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  if (errors.length) console.log('Renderer console errors:\n' + errors.slice(0, 20).join('\n'))
  await app.close().catch(() => {})
}
