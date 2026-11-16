// Tests 3 and 4 (without the AI step): real execution, exit codes, error capture, problems, Fix button.
import fs from 'node:fs'
import path from 'node:path'

async function runAndWait(page, S, file) {
  await S((p) => window.__localcode.getState().runPath(p), file)
  await page.waitForFunction(
    (p) => {
      const s = window.__localcode.getState()
      return !s.runId && s.lastRun && s.lastRun.file.toLowerCase() === p.toLowerCase()
    },
    file,
    { timeout: 60000 }
  )
  return S(() => window.__localcode.getState().lastRun)
}

export default async function ({ page, shot, S, workspace, log }) {
  const ok = path.join(workspace, 'hello.py')
  const r1 = await runAndWait(page, S, ok)
  log('python ok:', r1.status, 'exit', r1.exitCode, JSON.stringify(r1.stdout))
  if (r1.status !== 'success' || !r1.stdout.includes('Hello, Ada!')) throw new Error('Python run did not succeed')
  await shot('python-ok')

  const cpp = path.join(workspace, 'main.cpp')
  fs.writeFileSync(cpp, '#include <iostream>\nint main() {\n  int total = 0;\n  for (int i = 1; i <= 10; ++i) total += i;\n  std::cout << "sum=" << total << std::endl;\n  return 0;\n}\n')
  const r2 = await runAndWait(page, S, cpp)
  log('cpp:', r2.status, 'exit', r2.exitCode, JSON.stringify(r2.stdout))
  if (!r2.stdout.includes('sum=55')) throw new Error('C++ run failed: ' + r2.stderr)

  const js = path.join(workspace, 'calc.js')
  fs.writeFileSync(js, 'const xs = [3, 1, 2]\nconsole.log(xs.sort().join(","))\n')
  const r3 = await runAndWait(page, S, js)
  log('js:', r3.status, JSON.stringify(r3.stdout))

  const ts = path.join(workspace, 'util.ts')
  fs.writeFileSync(ts, 'const add = (a: number, b: number): number => a + b\nconsole.log(`ts ${add(2, 3)}`)\n')
  const r4 = await runAndWait(page, S, ts)
  log('ts:', r4.status, JSON.stringify(r4.stdout), r4.stderr.slice(0, 200))

  const bad = path.join(workspace, 'broken.py')
  fs.writeFileSync(bad, 'def average(values):\n    total = sum(values)\n    return total / len(value)\n\nprint(average([1, 2, 3]))\n')
  await S((p) => window.__localcode.getState().openFile(p), bad)
  const r5 = await runAndWait(page, S, bad)
  log('broken:', r5.status, 'exit', r5.exitCode, 'problems', JSON.stringify(r5.problems))
  if (r5.status !== 'error' || !r5.problems.length || r5.problems[0].line !== 3) throw new Error('Error was not captured correctly')
  const fixVisible = await page.getByRole('button', { name: 'Fix Error with AI' }).first().isVisible()
  log('fix button visible:', fixVisible)
  await shot('python-error')
  await S(() => window.__localcode.setState({ panelTab: 'problems' }))
  await page.waitForTimeout(300)
  await shot('problems')

  // Interactive stdin
  const ask = path.join(workspace, 'ask.py')
  fs.writeFileSync(ask, 'name = input("Name? ")\nprint("Hi " + name)\n')
  await S((p) => window.__localcode.getState().runPath(p), ask)
  await page.waitForFunction(() => !!window.__localcode.getState().runId, null, { timeout: 10000 })
  await page.waitForTimeout(800)
  await S(() => window.__localcode.getState().sendStdin('Grace\n'))
  await page.waitForFunction(() => !window.__localcode.getState().runId, null, { timeout: 15000 })
  const r6 = await S(() => window.__localcode.getState().lastRun)
  log('stdin:', JSON.stringify(r6.stdout))
  if (!r6.stdout.includes('Hi Grace')) throw new Error('stdin was not delivered')
}
