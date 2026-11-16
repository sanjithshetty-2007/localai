// Ctrl+Shift hides the assistant while it keeps working; the DSA slides PDF is ingested and searchable.
export default async function ({ page, shot, S, log }) {
  const visible = () => S(() => window.__localcode.getState().settings.aiSidebarVisible)
  const domHidden = () => page.evaluate(() => !!document.querySelector('aside[aria-label="AI assistant"]') && document.querySelector('aside[aria-label="AI assistant"]').offsetParent === null)
  if (!(await visible())) await S(() => window.__localcode.getState().updateSettings({ aiSidebarVisible: true }))

  // 1. Bare Ctrl+Shift toggles; Ctrl+Shift+S (save as) must not.
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  log('after Ctrl+Shift → visible:', await visible(), '| still mounted but hidden:', await domHidden())
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyF'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  log('after Ctrl+Shift+F → visible (unchanged):', await visible())

  // 2. While hidden, a request still runs to completion without surfacing anything.
  const tabsBefore = await S(() => window.__localcode.getState().tabs.length)
  const before = await S(() => window.__localcode.getState().messages.length)
  await S(() => window.__localcode.getState().sendMessage('In one sentence, what is a circular queue?'))
  await page.waitForTimeout(1500)
  const statusShowsAI = await page.evaluate(() => document.querySelector('footer')?.textContent?.includes('AI '))
  await shot('hidden-while-running')
  await page.waitForFunction((n) => {
    const s = window.__localcode.getState()
    return !s.stream && s.messages.length >= n + 2
  }, before, { timeout: 300000, polling: 500 })
  const reply = await S(() => window.__localcode.getState().messages.at(-1))
  const tabsAfter = await S(() => window.__localcode.getState().tabs.length)
  log('hidden: reply finished in background:', !!reply.content, '| status bar showed AI:', statusShowsAI, '| tabs opened:', tabsAfter - tabsBefore)
  log('  reply:', reply.content.slice(0, 140).replace(/\s+/g, ' '))

  // 3. Show again: the conversation is there.
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
  await page.waitForTimeout(400)
  log('after Ctrl+Shift again → visible:', await visible())
  await shot('shown-again')
}
