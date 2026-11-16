// PDF extraction, ZIP extraction into the workspace, file-action change sets with diff + undo.
import path from 'node:path'

export default async function ({ page, shot, S, workspace, outDir, log }) {
  const pdf = path.join(outDir, 'assignment.pdf')
  const zip = path.join(outDir, 'project.zip')

  const atts = await S((paths) => window.api.attachments.addPaths(paths), [pdf, zip])
  log('attachments:', JSON.stringify(atts.map((a) => ({ kind: a.kind, name: a.name, pages: a.pages, chars: a.chars, files: a.fileCount, to: a.extractedTo }))))
  if (atts[0].pages !== 2 || !(atts[0].chars > 100)) throw new Error('PDF extraction failed')
  if (!(atts[1].fileCount >= 2)) throw new Error('ZIP extraction failed')

  await S((a) => window.__localcode.setState({ pendingAttachments: a }), atts)
  await S(() => window.__localcode.getState().refreshTree())
  await page.waitForTimeout(600)
  await shot('pending')

  // Change set workflow without a model: propose an edit to hello.py, review diff, accept, undo.
  const hello = path.join(workspace, 'hello.py')
  await S((p) => window.__localcode.getState().openFile(p), hello)
  const original = await S((p) => window.api.fs.read(p), hello)
  await S(([p, c]) => window.__localcode.getState().proposeEdit(p, c), [hello, original.replace("'Ada', 'Linus'", "'Ada', 'Linus', 'Grace'")])
  await page.waitForTimeout(1500)
  await shot('diff')
  const cs = await S(() => Object.values(window.__localcode.getState().changeSets)[0])
  log('changeset items:', JSON.stringify(cs.items.map((i) => ({ type: i.action.type, path: i.action.path, added: i.added, removed: i.removed, status: i.status }))))
  await S((id) => window.__localcode.getState().applyChanges(id), cs.id)
  await page.waitForTimeout(800)
  const after = await S((p) => window.api.fs.read(p), hello)
  const editorText = await S((p) => window.__localcode.getState().tabs.find((t) => t.id === p)?.content, hello)
  log('applied on disk:', after.includes('Grace'), 'editor updated:', editorText?.includes('Grace'))
  await shot('applied')
  await S((id) => window.__localcode.getState().undoChanges(id), cs.id)
  await page.waitForTimeout(800)
  const undone = await S((p) => window.api.fs.read(p), hello)
  log('undo restored:', undone === original)
  if (!after.includes('Grace') || undone !== original) throw new Error('apply/undo failed')

  // Path traversal through the AI edit path must be refused.
  const conv = await S(() => window.__localcode.getState().conversationId)
  const refused = await S(([c]) => window.api.changes.proposeEdit(c, '../../outside.txt', 'x').then(() => 'accepted', (e) => String(e.message)), [conv])
  log('traversal edit:', refused)
  if (refused === 'accepted') throw new Error('Path traversal was accepted')
}
