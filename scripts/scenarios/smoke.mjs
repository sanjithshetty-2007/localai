// Launch, open a file, toggle theme, check the terminal and settings render.
export default async function ({ page, shot, state, S, workspace, log }) {
  await shot('start')
  if (workspace) {
    const s = await state()
    log('workspace', s.workspace)
    const file = await S(() => {
      const st = window.__localcode.getState()
      const f = st.tree?.children?.find((c) => c.type === 'file')
      return f?.path
    })
    if (file) {
      await S((p) => window.__localcode.getState().openFile(p), file)
      await page.waitForTimeout(1500)
      await shot('file-open')
    }
  }
  await S(() => window.__localcode.getState().togglePanel('terminal'))
  await page.waitForTimeout(2500)
  await shot('terminal')
  await S(() => window.__localcode.getState().toggleTheme())
  await page.waitForTimeout(800)
  await shot('light')
  await S(() => window.__localcode.getState().toggleTheme())
  await S(() => window.__localcode.getState().openSettings())
  await page.waitForTimeout(1200)
  await shot('settings')
  log('state', JSON.stringify(await state()))
}
