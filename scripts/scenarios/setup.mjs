// First-run wizard: stays closed when everything is installed; shows the right steps otherwise.
export default async function ({ page, shot, S, log }) {
  await page.waitForTimeout(4000)
  log('fresh profile, everything installed → wizard open:', await S(() => window.__localcode.getState().setupOpen), '| setupDone:', await S(() => window.__localcode.getState().settings.setupDone))
  const st = await S(() => window.api.setup.status())
  log('status:', st.hardwareSummary, '| ollama', st.ollamaRunning, st.ollamaVersion, '| profile', st.profile, 'recommended', st.recommendedProfile)
  log('models:', st.required.map((m) => `${m.name}${m.installed ? '✓' : '✗'}`).join(' '), '| sizes', JSON.stringify(st.presets))
  // Simulate a computer where Ollama is not reachable.
  await S(() => window.__localcode.getState().updateSettings({ ollamaUrl: 'http://127.0.0.1:9' }))
  await S(() => window.__localcode.setState({ setupOpen: true }))
  await page.waitForTimeout(5000)
  await shot('wizard-no-ollama')
  await S(() => window.__localcode.getState().updateSettings({ ollamaUrl: 'http://localhost:11434' }))
  await page.getByRole('button', { name: 'Check again' }).click()
  await page.waitForTimeout(5000)
  await shot('wizard-ready')
  log('Finish enabled when ready:', await page.getByRole('button', { name: 'Finish' }).isEnabled())
}
