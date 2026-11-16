import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { LocalCodeApi, Unsubscribe } from '../shared/api'

// Only explicit, named channels are exposed. The renderer never receives ipcRenderer itself.
const inv =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: LocalCodeApi = {
  app: {
    info: inv('app:info') as LocalCodeApi['app']['info'],
    setTheme: inv('app:setTheme') as LocalCodeApi['app']['setTheme'],
    openExternal: inv('app:openExternal') as LocalCodeApi['app']['openExternal']
  },
  settings: {
    get: inv('settings:get') as LocalCodeApi['settings']['get'],
    set: inv('settings:set') as LocalCodeApi['settings']['set']
  },
  hardware: { detect: inv('hardware:detect') as LocalCodeApi['hardware']['detect'] },
  fs: {
    pickFolder: inv('fs:pickFolder') as LocalCodeApi['fs']['pickFolder'],
    openWorkspace: inv('fs:openWorkspace') as LocalCodeApi['fs']['openWorkspace'],
    closeWorkspace: inv('fs:closeWorkspace') as LocalCodeApi['fs']['closeWorkspace'],
    tree: inv('fs:tree') as LocalCodeApi['fs']['tree'],
    read: inv('fs:read') as LocalCodeApi['fs']['read'],
    write: inv('fs:write') as LocalCodeApi['fs']['write'],
    saveAs: inv('fs:saveAs') as LocalCodeApi['fs']['saveAs'],
    createFile: inv('fs:createFile') as LocalCodeApi['fs']['createFile'],
    createDir: inv('fs:createDir') as LocalCodeApi['fs']['createDir'],
    rename: inv('fs:rename') as LocalCodeApi['fs']['rename'],
    move: inv('fs:move') as LocalCodeApi['fs']['move'],
    remove: inv('fs:remove') as LocalCodeApi['fs']['remove'],
    search: inv('fs:search') as LocalCodeApi['fs']['search'],
    reveal: inv('fs:reveal') as LocalCodeApi['fs']['reveal'],
    importZip: inv('fs:importZip') as LocalCodeApi['fs']['importZip'],
    exportZip: inv('fs:exportZip') as LocalCodeApi['fs']['exportZip'],
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    onChanged: (cb) => on('fs:changed', cb)
  },
  ollama: {
    status: inv('ollama:status') as LocalCodeApi['ollama']['status'],
    start: inv('ollama:start') as LocalCodeApi['ollama']['start'],
    pull: inv('ollama:pull') as LocalCodeApi['ollama']['pull'],
    cancelPull: inv('ollama:cancelPull') as LocalCodeApi['ollama']['cancelPull'],
    unload: inv('ollama:unload') as LocalCodeApi['ollama']['unload'],
    remove: inv('ollama:remove') as LocalCodeApi['ollama']['remove'],
    onPullProgress: (cb) => on('ollama:pullProgress', cb)
  },
  chat: {
    list: inv('chat:list') as LocalCodeApi['chat']['list'],
    create: inv('chat:create') as LocalCodeApi['chat']['create'],
    messages: inv('chat:messages') as LocalCodeApi['chat']['messages'],
    rename: inv('chat:rename') as LocalCodeApi['chat']['rename'],
    remove: inv('chat:remove') as LocalCodeApi['chat']['remove'],
    clear: inv('chat:clear') as LocalCodeApi['chat']['clear'],
    send: inv('chat:send') as LocalCodeApi['chat']['send'],
    stop: inv('chat:stop') as LocalCodeApi['chat']['stop'],
    onEvent: (cb) => on('chat:event', cb)
  },
  attachments: {
    pick: inv('attachments:pick') as LocalCodeApi['attachments']['pick'],
    addPaths: inv('attachments:addPaths') as LocalCodeApi['attachments']['addPaths'],
    addImageData: inv('attachments:addImageData') as LocalCodeApi['attachments']['addImageData'],
    remove: inv('attachments:remove') as LocalCodeApi['attachments']['remove']
  },
  changes: {
    get: inv('changes:get') as LocalCodeApi['changes']['get'],
    apply: inv('changes:apply') as LocalCodeApi['changes']['apply'],
    reject: inv('changes:reject') as LocalCodeApi['changes']['reject'],
    undo: inv('changes:undo') as LocalCodeApi['changes']['undo'],
    proposeEdit: inv('changes:proposeEdit') as LocalCodeApi['changes']['proposeEdit']
  },
  run: {
    file: inv('run:file') as LocalCodeApi['run']['file'],
    stop: inv('run:stop') as LocalCodeApi['run']['stop'],
    stdin: inv('run:stdin') as LocalCodeApi['run']['stdin'],
    runtimes: inv('run:runtimes') as LocalCodeApi['run']['runtimes'],
    onEvent: (cb) => on('run:event', cb)
  },
  terminal: {
    create: inv('terminal:create') as LocalCodeApi['terminal']['create'],
    write: (id, data) => ipcRenderer.send('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('terminal:kill', id),
    onData: (cb) => on('terminal:data', cb),
    onExit: (cb) => on('terminal:exit', cb)
  },
  updates: {
    state: inv('updates:state') as LocalCodeApi['updates']['state'],
    check: inv('updates:check') as LocalCodeApi['updates']['check'],
    install: inv('updates:install') as LocalCodeApi['updates']['install'],
    onState: (cb) => on('updates:state', cb)
  },
  setup: {
    status: inv('setup:status') as LocalCodeApi['setup']['status'],
    installOllama: inv('setup:installOllama') as LocalCodeApi['setup']['installOllama'],
    pullModels: inv('setup:pullModels') as LocalCodeApi['setup']['pullModels'],
    cancel: inv('setup:cancel') as LocalCodeApi['setup']['cancel'],
    onProgress: (cb) => on('setup:progress', cb)
  },
  knowledge: {
    list: inv('knowledge:list') as LocalCodeApi['knowledge']['list'],
    add: inv('knowledge:add') as LocalCodeApi['knowledge']['add'],
    remove: inv('knowledge:remove') as LocalCodeApi['knowledge']['remove'],
    setEnabled: inv('knowledge:setEnabled') as LocalCodeApi['knowledge']['setEnabled'],
    reembed: inv('knowledge:reembed') as LocalCodeApi['knowledge']['reembed'],
    search: inv('knowledge:search') as LocalCodeApi['knowledge']['search'],
    onProgress: (cb) => on('knowledge:progress', cb)
  },
  memory: {
    get: inv('memory:get') as LocalCodeApi['memory']['get'],
    setNotes: inv('memory:setNotes') as LocalCodeApi['memory']['setNotes'],
    clear: inv('memory:clear') as LocalCodeApi['memory']['clear'],
    reindex: inv('memory:reindex') as LocalCodeApi['memory']['reindex'],
    indexStatus: inv('memory:indexStatus') as LocalCodeApi['memory']['indexStatus'],
    onIndexStatus: (cb) => on('memory:indexStatus', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
