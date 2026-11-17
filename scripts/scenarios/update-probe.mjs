// Packaged build: trigger an update check and follow it until the download finishes (never installs).
export default async function ({ page, S, log }) {
  log('running version:', (await S(() => window.api.app.info())).version)
  log('check →', JSON.stringify(await S(() => window.api.updates.check())))
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < 300000) {
    const st = await S(() => window.api.updates.state())
    const line = `${st.status}${st.latestVersion ? ' ' + st.latestVersion : ''}${st.percent != null ? ' ' + st.percent + '%' : ''}${st.error ? ' — ' + st.error : ''}`
    if (line !== last) log(`  ${Math.round((Date.now() - t0) / 1000)}s: ${line}`)
    last = line
    if (['ready', 'latest', 'error', 'available', 'unsupported'].includes(st.status)) break
    await page.waitForTimeout(2000)
  }
  const bar = await page.evaluate(() => document.querySelector('footer')?.textContent ?? '')
  log('status bar shows:', bar.includes('Restart to update') ? '"Restart to update"' : bar.slice(0, 120))
}
