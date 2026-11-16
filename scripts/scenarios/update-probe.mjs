// Packaged build: trigger an update check and report the updater state.
export default async function ({ page, S, log }) {
  log('version:', (await S(() => window.api.app.info())).version)
  const st = await S(() => window.api.updates.check())
  log('update check →', JSON.stringify(st))
  await page.waitForTimeout(4000)
  log('state after 4s →', JSON.stringify(await S(() => window.api.updates.state())))
}
