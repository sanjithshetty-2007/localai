import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppInfo, ChatEvent, ChatRequest, FileNode, IndexStatus, PullProgress, RunEvent, Settings, ThemeName } from '../../shared/types'
import { dbPath, getSettings, saveSettings } from '../services/db'
import { getWorkspaceRoot, requireWorkspace, resolveInWorkspace, setWorkspaceRoot } from '../security/paths'
import * as fsx from '../filesystem/fs-service'
import { createZip, safeExtractZip } from '../filesystem/zip'
import { OllamaClient, getStatus, startOllamaServer } from '../services/ollama'
import { detectHardware } from '../services/hardware'
import { ProjectIndexer, clearProjectMemory, getProjectMemory, setProjectNotes } from '../services/indexer'
import { CodeRunner, detectRuntimes } from '../terminal/runner'
import { TerminalManager } from '../terminal/pty'
import { Orchestrator } from '../services/orchestrator'
import * as memory from '../services/memory'
import { addAttachmentFromPath, addImageFromDataUrl, removeAttachment } from '../services/documents'
import { applyChangeSet, loadChangeSet, proposeEdit, rejectChangeSet, undoChangeSet } from '../services/file-actions'
import { KnowledgeLibrary, migrateKnowledge } from '../services/knowledge'
import { SetupManager } from '../services/setup'

export const TITLEBAR_COLORS: Record<ThemeName, { color: string; symbolColor: string }> = {
  dark: { color: '#3c3c3c', symbolColor: '#cccccc' },
  light: { color: '#dddddd', symbolColor: '#333333' }
}

let runner: CodeRunner | null = null
let terminals: TerminalManager | null = null
let watcher: fsx.WorkspaceWatcher | null = null
const pulls = new Map<string, AbortController>()

export function shutdownServices(): void {
  runner?.stopAll()
  terminals?.killAll()
  watcher?.stop()
  for (const c of pulls.values()) c.abort()
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Error(`${name} must be a string`)
  return v
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, ...args: unknown[]) => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
  }
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) => {
    ipcMain.handle(channel, (_e: IpcMainInvokeEvent, ...args: unknown[]) => fn(...(args as A)))
  }

  const settings0 = getSettings()
  const ollama = new OllamaClient(settings0.ollamaUrl)
  const indexer = new ProjectIndexer((s: IndexStatus) => send('memory:indexStatus', s))
  runner = new CodeRunner((e: RunEvent) => send('run:event', e))
  terminals = new TerminalManager(
    (id, data) => send('terminal:data', id, data),
    (id, code) => send('terminal:exit', id, code)
  )
  let tree: FileNode | null = null
  let reindexTimer: NodeJS.Timeout | null = null
  const scheduleReindex = () => {
    const ws = getWorkspaceRoot()
    if (!ws) return
    if (reindexTimer) clearTimeout(reindexTimer)
    reindexTimer = setTimeout(() => void indexer.index(ws).catch(() => undefined), 4000)
  }
  watcher = new fsx.WorkspaceWatcher((paths) => {
    send('fs:changed', { paths })
    scheduleReindex()
  })
  const touched = (paths: string[]) => {
    send('fs:changed', { paths })
    scheduleReindex()
  }
  migrateKnowledge()
  const knowledge = new KnowledgeLibrary(ollama, (p) => send('knowledge:progress', p))
  // Built-in DSA reference shipped with the app (re-installed when its version changes).
  const dsaRef = app.isPackaged ? path.join(process.resourcesPath, 'knowledge', 'dsa-reference.md') : path.join(app.getAppPath(), 'resources', 'knowledge', 'dsa-reference.md')
  void knowledge.ensureBuiltin('builtin-dsa', 'DSA Reference (built-in)', dsaRef, 1).catch(() => undefined)
  const orchestrator = new Orchestrator(ollama, indexer, runner, (e: ChatEvent) => send('chat:event', e), () => tree, touched, knowledge)

  const openWorkspace = async (dir: string) => {
    const abs = path.resolve(str(dir, 'path'))
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Folder not found: ${abs}`)
    setWorkspaceRoot(abs)
    const root = getWorkspaceRoot()!
    tree = await fsx.buildTree(root)
    watcher!.start(root)
    indexer.setWorkspace(root)
    saveSettings({ lastWorkspace: root })
    void indexer.index(root).catch(() => undefined)
    return { root, tree }
  }

  // ---------- app ----------
  handle('app:info', (): AppInfo => ({
    name: 'LocalCode AI Studio',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    userData: app.getPath('userData'),
    dbPath: dbPath()
  }))
  handle('app:setTheme', (theme: ThemeName) => {
    const t = theme === 'light' ? 'light' : 'dark'
    saveSettings({ theme: t })
    const w = getWindow()
    if (w && process.platform !== 'darwin') {
      try {
        w.setTitleBarOverlay({ ...TITLEBAR_COLORS[t], height: 34 })
      } catch {
        /* overlay unsupported */
      }
    }
    w?.setBackgroundColor(t === 'dark' ? '#1e1e1e' : '#ffffff')
  })
  handle('app:openExternal', async (url: string) => {
    const u = str(url, 'url')
    if (!/^https:\/\/(ollama\.com|github\.com|www\.python\.org|nodejs\.org|adoptium\.net|www\.msys2\.org)\//.test(u)) throw new Error('Blocked URL')
    await shell.openExternal(u)
  })

  // ---------- settings / hardware ----------
  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<Settings>) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings')
    if (patch.ollamaUrl !== undefined && !/^https?:\/\/[^\s]+$/.test(patch.ollamaUrl)) {
      throw new Error('Ollama URL must start with http:// or https://')
    }
    const next = saveSettings(patch)
    if (patch.ollamaUrl) ollama.setBaseUrl(patch.ollamaUrl)
    return next
  })
  handle('hardware:detect', () => detectHardware())

  // ---------- filesystem ----------
  handle('fs:pickFolder', async () => {
    const w = getWindow()
    const r = await dialog.showOpenDialog(w!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('fs:openWorkspace', (dir: string) => openWorkspace(dir))
  handle('fs:closeWorkspace', () => {
    watcher!.stop()
    setWorkspaceRoot(null)
    indexer.setWorkspace(null)
    tree = null
    saveSettings({ lastWorkspace: null })
  })
  handle('fs:tree', async () => {
    const ws = getWorkspaceRoot()
    if (!ws) return null
    tree = await fsx.buildTree(ws)
    return tree
  })
  handle('fs:read', (p: string) => fsx.readText(str(p, 'path')))
  handle('fs:write', async (p: string, content: string) => {
    await fsx.writeText(str(p, 'path'), str(content, 'content'))
  })
  handle('fs:saveAs', async (defaultPath: string, content: string) => {
    const w = getWindow()
    const r = await dialog.showSaveDialog(w!, { defaultPath: str(defaultPath, 'path') })
    if (r.canceled || !r.filePath) return null
    resolveInWorkspace(r.filePath) // Save As is restricted to the workspace too
    await fsx.writeText(r.filePath, str(content, 'content'))
    return r.filePath
  })
  handle('fs:createFile', (p: string) => fsx.createFile(str(p, 'path')))
  handle('fs:createDir', (p: string) => fsx.createDir(str(p, 'path')))
  handle('fs:rename', (a: string, b: string) => fsx.renamePath(str(a, 'from'), str(b, 'to')))
  handle('fs:move', (a: string, d: string) => fsx.movePath(str(a, 'from'), str(d, 'toDir')))
  handle('fs:remove', async (p: string) => {
    const abs = resolveInWorkspace(str(p, 'path'))
    if (abs === requireWorkspace()) throw new Error('Cannot delete the workspace root')
    await shell.trashItem(abs)
  })
  handle('fs:search', (q: string, opts: { regex?: boolean; caseSensitive?: boolean }) => fsx.searchWorkspace(str(q, 'query'), opts ?? {}))
  handle('fs:reveal', (p: string) => shell.showItemInFolder(resolveInWorkspace(str(p, 'path'))))
  handle('fs:importZip', async (zipPath?: string) => {
    let file = zipPath
    if (!file) {
      const r = await dialog.showOpenDialog(getWindow()!, { properties: ['openFile'], filters: [{ name: 'ZIP archives', extensions: ['zip'] }] })
      if (r.canceled) return null
      file = r.filePaths[0]
    }
    const ws = getWorkspaceRoot()
    let dest: string
    if (ws) {
      dest = path.join(ws, path.basename(file).replace(/\.zip$/i, ''))
    } else {
      const r = await dialog.showOpenDialog(getWindow()!, { title: 'Choose where to extract the project', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled) return null
      dest = path.join(r.filePaths[0], path.basename(file).replace(/\.zip$/i, ''))
    }
    let d = dest
    for (let i = 1; fs.existsSync(d); i++) d = `${dest}-${i}`
    fs.mkdirSync(d, { recursive: true })
    try {
      const { files } = await safeExtractZip(file, d)
      if (!ws) await openWorkspace(d)
      else touched([d])
      return { root: d, files }
    } catch (e) {
      fs.rmSync(d, { recursive: true, force: true })
      throw e
    }
  })
  handle('fs:exportZip', async (dir?: string) => {
    const src = dir ? resolveInWorkspace(dir) : requireWorkspace()
    const r = await dialog.showSaveDialog(getWindow()!, { defaultPath: path.basename(src) + '.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] })
    if (r.canceled || !r.filePath) return null
    await createZip(src, r.filePath)
    return r.filePath
  })

  // ---------- ollama ----------
  handle('ollama:status', () => {
    ollama.setBaseUrl(getSettings().ollamaUrl)
    return getStatus(ollama)
  })
  handle('ollama:start', () => startOllamaServer())
  handle('ollama:pull', async (model: string) => {
    const name = str(model, 'model').trim()
    if (!/^[\w.\-/:]+$/.test(name)) throw new Error('Invalid model name')
    if (pulls.has(name)) return
    const ctrl = new AbortController()
    pulls.set(name, ctrl)
    try {
      await ollama.pull(name, (p: PullProgress) => send('ollama:pullProgress', p), ctrl.signal)
    } catch (e) {
      send('ollama:pullProgress', { model: name, status: 'error', error: ctrl.signal.aborted ? 'Cancelled' : (e as Error).message, done: true })
    } finally {
      pulls.delete(name)
    }
  })
  handle('ollama:cancelPull', (model: string) => pulls.get(model)?.abort())
  handle('ollama:unload', (model: string) => ollama.unload(str(model, 'model')))
  handle('ollama:remove', (model: string) => ollama.remove(str(model, 'model')))

  // ---------- chat ----------
  handle('chat:list', () => memory.listConversations())
  handle('chat:create', () => memory.createConversation(getWorkspaceRoot()))
  handle('chat:messages', (id: string) => memory.getMessages(str(id, 'id')))
  handle('chat:rename', (id: string, title: string) => memory.renameConversation(str(id, 'id'), str(title, 'title')))
  handle('chat:remove', (id: string) => memory.deleteConversation(str(id, 'id')))
  handle('chat:clear', (id: string) => memory.clearConversation(str(id, 'id')))
  handle('chat:send', (req: ChatRequest) => {
    if (!req || typeof req.conversationId !== 'string' || typeof req.text !== 'string') throw new Error('Invalid chat request')
    if (req.context?.workspace && req.context.workspace !== getWorkspaceRoot()) req.context.workspace = getWorkspaceRoot()
    // Fire and forget: progress arrives as chat:event messages.
    void orchestrator.send(req).catch((e: Error) =>
      send('chat:event', { type: 'error', conversationId: req.conversationId, messageId: '', error: e.message } satisfies ChatEvent)
    )
  })
  handle('chat:stop', (id: string) => orchestrator.stop(str(id, 'id')))

  // ---------- attachments ----------
  handle('attachments:pick', async () => {
    const r = await dialog.showOpenDialog(getWindow()!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'txt', 'md', 'js', 'ts', 'tsx', 'jsx', 'py', 'cpp', 'c', 'h', 'java', 'json', 'html', 'css', 'zip'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (r.canceled) return []
    const out = []
    for (const p of r.filePaths) out.push(await addAttachmentFromPath(p))
    if (out.some((a) => a.kind === 'zip')) touched([])
    return out
  })
  handle('attachments:addPaths', async (paths: string[]) => {
    if (!Array.isArray(paths)) throw new Error('paths must be an array')
    const out = []
    for (const p of paths.slice(0, 20)) out.push(await addAttachmentFromPath(str(p, 'path')))
    if (out.some((a) => a.kind === 'zip')) touched([])
    return out
  })
  handle('attachments:addImageData', (name: string, dataUrl: string) => addImageFromDataUrl(str(name, 'name'), str(dataUrl, 'dataUrl')))
  handle('attachments:remove', (id: string) => removeAttachment(str(id, 'id')))

  // ---------- change sets ----------
  handle('changes:get', (id: string) => loadChangeSet(str(id, 'id')))
  handle('changes:apply', async (id: string, itemIds?: string[]) => {
    const { cs, touched: t } = await applyChangeSet(str(id, 'id'), itemIds, runner!)
    touched(t)
    return cs
  })
  handle('changes:reject', (id: string, itemIds?: string[]) => rejectChangeSet(str(id, 'id'), itemIds))
  handle('changes:undo', async (id: string) => {
    const { cs, touched: t } = await undoChangeSet(str(id, 'id'))
    touched(t)
    return cs
  })
  handle('changes:proposeEdit', (convId: string, p: string, content: string) => proposeEdit(str(convId, 'conversationId'), str(p, 'path'), str(content, 'content')))

  // ---------- execution ----------
  handle('run:file', (p: string) => runner!.runFile(resolveInWorkspace(str(p, 'path'))))
  handle('run:stop', (id: string) => runner!.stop(str(id, 'runId')))
  handle('run:stdin', (id: string, text: string) => runner!.stdin(str(id, 'runId'), str(text, 'text')))
  handle('run:runtimes', async () => (await detectRuntimes(true)).info)

  // ---------- terminal ----------
  handle('terminal:create', (cols: number, rows: number) => terminals!.create(Number(cols), Number(rows), getWorkspaceRoot(), getSettings().terminalShell))
  ipcMain.on('terminal:write', (_e, id: string, data: string) => {
    if (typeof id === 'string' && typeof data === 'string') terminals!.write(id, data)
  })
  ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) => terminals!.resize(String(id), Number(cols), Number(rows)))
  ipcMain.on('terminal:kill', (_e, id: string) => terminals!.kill(String(id)))

  // ---------- first-run setup ----------
  const setup = new SetupManager(ollama, (p) => send('setup:progress', p))
  handle('setup:status', () => setup.status())
  handle('setup:installOllama', () => setup.installOllama())
  handle('setup:pullModels', (models: string[]) => {
    if (!Array.isArray(models) || models.some((m) => typeof m !== 'string' || !/^[\w.\-/:]+$/.test(m))) throw new Error('Invalid model list')
    return setup.pullModels(models.slice(0, 12))
  })
  handle('setup:cancel', () => setup.cancel())

  // ---------- knowledge library ----------
  handle('knowledge:list', () => knowledge.list())
  handle('knowledge:add', async (paths?: string[]) => {
    let files = Array.isArray(paths) ? paths.map((p) => str(p, 'path')) : []
    if (!files.length) {
      const r = await dialog.showOpenDialog(getWindow()!, {
        title: 'Add to knowledge library',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'json', 'html'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (r.canceled) return { added: [], errors: [] }
      files = r.filePaths
    }
    const added = []
    const errors: string[] = []
    for (const f of files.slice(0, 30)) {
      try {
        added.push(await knowledge.add(f))
      } catch (e) {
        errors.push(`${path.basename(f)}: ${(e as Error).message}`)
      }
    }
    return { added, errors }
  })
  handle('knowledge:remove', (id: string) => {
    const docId = str(id, 'id')
    // Built-in references are switched off rather than deleted (they would return on restart).
    if (docId.startsWith('builtin-')) knowledge.setEnabled(docId, false)
    else knowledge.remove(docId)
  })
  handle('knowledge:setEnabled', (id: string, enabled: boolean) => {
    knowledge.setEnabled(str(id, 'id'), !!enabled)
    knowledge.invalidate()
  })
  handle('knowledge:reembed', async () => {
    await knowledge.reembedAll()
    return knowledge.list()
  })
  handle('knowledge:search', (q: string) => knowledge.search(str(q, 'query'), 6000))

  // ---------- memory / index ----------
  handle('memory:get', () => {
    const ws = getWorkspaceRoot()
    return ws ? getProjectMemory(ws) : null
  })
  handle('memory:setNotes', (notes: string) => setProjectNotes(requireWorkspace(), str(notes, 'notes')))
  handle('memory:clear', () => {
    const ws = requireWorkspace()
    clearProjectMemory(ws)
    indexer.setWorkspace(ws)
  })
  handle('memory:reindex', () => indexer.index(requireWorkspace()))
  handle('memory:indexStatus', () => indexer.getStatus())

}
