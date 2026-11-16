import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, FilePlus, FileArchive, FolderPlus, FolderOpen, MessageSquare, Pencil, Play, RefreshCw, Trash2, ListCollapse, Upload, ExternalLink, X } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { useApp } from '@/store/app'
import { api, basename, dirname, errorMessage, joinPath, relativePath, RUNNABLE, samePath } from '@/lib/api'
import { Button, ContextMenu, EmptyState, IconButton, SectionHeader, type MenuItem } from '../ui'
import { FileIcon } from '../fileIcon'

type Editing = { mode: 'newFile' | 'newFolder'; parent: string } | { mode: 'rename'; path: string } | null

function InlineInput({ initial, depth, isDir, onDone }: { initial: string; depth: number; isDir: boolean; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 && !isDir ? dot : initial.length)
  }, [initial, isDir])
  const invalid = /[<>:"|?*]/.test(value) || value.includes('..')
  return (
    <div className="flex h-[22px] items-center gap-1 pr-2" style={{ paddingLeft: 8 + depth * 8 + 16 }}>
      <FileIcon name={value || (isDir ? 'folder' : 'file')} isDir={isDir} />
      <input
        ref={ref}
        value={value}
        spellCheck={false}
        aria-label={isDir ? 'Folder name' : 'File name'}
        className={`selectable h-[20px] min-w-0 flex-1 border bg-input px-1 text-ui text-fg outline-none ${invalid ? 'border-error' : 'border-focus'}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onDone(value.trim() && !invalid ? value.trim() : null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone(value.trim() && !invalid ? value.trim() : null)
          if (e.key === 'Escape') onDone(null)
        }}
      />
    </div>
  )
}

export function Explorer() {
  const workspace = useApp((s) => s.workspace)
  const tree = useApp((s) => s.tree)
  const expanded = useApp((s) => s.expanded)
  const selectedPath = useApp((s) => s.selectedPath)
  const activeTabId = useApp((s) => s.activeTabId)
  const store = useApp.getState()
  const [editing, setEditing] = useState<Editing>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const selectedDir = useCallback((): string => {
    if (!workspace) return ''
    const sel = useApp.getState().selectedPath
    if (!sel) return workspace
    const find = (n: FileNode): FileNode | null => {
      if (samePath(n.path, sel)) return n
      for (const c of n.children ?? []) {
        const f = find(c)
        if (f) return f
      }
      return null
    }
    const node = tree ? find(tree) : null
    return node?.type === 'directory' ? node.path : dirname(sel)
  }, [workspace, tree])

  const startNew = (mode: 'newFile' | 'newFolder', parent?: string) => {
    const p = parent ?? selectedDir()
    store.toggleExpanded(p, true)
    setEditing({ mode, parent: p })
  }

  const finishEdit = async (value: string | null) => {
    const e = editing
    setEditing(null)
    if (!e || !value) return
    try {
      if (e.mode === 'newFile') {
        const p = joinPath(e.parent, value)
        await api.fs.createFile(p)
        await store.refreshTree()
        await store.openFile(p)
      } else if (e.mode === 'newFolder') {
        await api.fs.createDir(joinPath(e.parent, value))
        await store.refreshTree()
      } else if (e.mode === 'rename') {
        if (value === basename(e.path)) return
        const target = joinPath(dirname(e.path), value)
        const s = useApp.getState()
        const open = s.tabs.find((t) => t.kind === 'file' && samePath(t.path, e.path))
        if (open && open.kind === 'file' && open.content !== open.saved) {
          store.toast('info', 'Save or close the file before renaming it.')
          return
        }
        await api.fs.rename(e.path, target)
        if (open) {
          await store.closeTab(open.id, true)
          await store.openFile(target)
        }
        await store.refreshTree()
      }
    } catch (err) {
      store.toast('error', errorMessage(err))
    }
  }

  const remove = async (node: FileNode) => {
    const ok = await store.confirm(
      `Delete ${node.type === 'directory' ? 'folder' : 'file'}`,
      `Move "${relativePath(workspace, node.path)}"${node.type === 'directory' ? ' and its contents' : ''} to the system trash?`,
      'Move to Trash',
      true
    )
    if (!ok) return
    try {
      await api.fs.remove(node.path)
      for (const t of useApp.getState().tabs) {
        if (t.kind === 'file' && (samePath(t.path, node.path) || t.path.toLowerCase().startsWith(node.path.toLowerCase() + (node.path.includes('\\') ? '\\' : '/')))) {
          await store.closeTab(t.id, true)
        }
      }
      await store.refreshTree()
    } catch (err) {
      store.toast('error', errorMessage(err))
    }
  }

  const exportZip = async (dir?: string) => {
    try {
      const out = await api.fs.exportZip(dir)
      if (out) store.toast('success', `Exported to ${out}`)
    } catch (err) {
      store.toast('error', errorMessage(err))
    }
  }

  const importZip = async (zipPath?: string) => {
    try {
      const r = await api.fs.importZip(zipPath)
      if (r) {
        store.toast('success', `Extracted ${r.files} files to ${basename(r.root)}`)
        await store.refreshTree()
        if (useApp.getState().workspace && !samePath(useApp.getState().workspace!, r.root)) store.toggleExpanded(r.root, true)
      }
    } catch (err) {
      store.toast('error', `ZIP import failed: ${errorMessage(err)}`)
    }
  }

  const menuItems = (node: FileNode): MenuItem[] => {
    const isDir = node.type === 'directory'
    const isRoot = workspace && samePath(node.path, workspace)
    const items: MenuItem[] = []
    if (isDir) {
      items.push({ label: 'New File…', icon: FilePlus, onClick: () => startNew('newFile', node.path) })
      items.push({ label: 'New Folder…', icon: FolderPlus, onClick: () => startNew('newFolder', node.path) })
      items.push({ label: 'Export as ZIP…', icon: FileArchive, onClick: () => void exportZip(node.path) })
      items.push({ label: '', onClick: () => undefined, separator: true })
    } else {
      if (RUNNABLE.test(node.name)) items.push({ label: 'Run File', icon: Play, onClick: () => void store.runPath(node.path) })
      items.push({
        label: 'Ask AI About This File',
        icon: MessageSquare,
        onClick: async () => {
          await store.openFile(node.path)
          store.focusChat(`Explain ${relativePath(workspace, node.path)}: what it does and anything that looks wrong.`)
        }
      })
      items.push({ label: '', onClick: () => undefined, separator: true })
    }
    items.push({ label: 'Copy Path', icon: Copy, onClick: () => void navigator.clipboard.writeText(node.path) })
    items.push({ label: 'Copy Relative Path', icon: Copy, onClick: () => void navigator.clipboard.writeText(relativePath(workspace, node.path)) })
    items.push({ label: 'Reveal in File Manager', icon: ExternalLink, onClick: () => void api.fs.reveal(node.path) })
    if (!isRoot) {
      items.push({ label: '', onClick: () => undefined, separator: true })
      items.push({ label: 'Rename…', icon: Pencil, onClick: () => setEditing({ mode: 'rename', path: node.path }) })
      items.push({ label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove(node) })
    }
    return items
  }

  const onDrop = async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const internal = e.dataTransfer.getData('application/x-localcode-path')
    if (internal) {
      if (samePath(dirname(internal), targetDir)) return
      try {
        const moved = await api.fs.move(internal, targetDir)
        const tab = useApp.getState().tabs.find((t) => t.kind === 'file' && samePath(t.path, internal))
        if (tab) {
          await store.closeTab(tab.id, true)
          await store.openFile(moved)
        }
        await store.refreshTree()
      } catch (err) {
        store.toast('error', errorMessage(err))
      }
      return
    }
    const files = [...e.dataTransfer.files]
    const zips = files.filter((f) => /\.zip$/i.test(f.name))
    for (const z of zips) await importZip(api.fs.pathForFile(z))
    if (files.length > zips.length) store.toast('info', 'Drop files into the AI chat to attach them, or ZIP files here to extract a project.')
  }

  const renderNode = (node: FileNode, depth: number): React.ReactNode => {
    const isDir = node.type === 'directory'
    const open = !!expanded[node.path]
    const isRenaming = editing?.mode === 'rename' && samePath(editing.path, node.path)
    const isActive = activeTabId != null && samePath(activeTabId, node.path)
    const selected = selectedPath != null && samePath(selectedPath, node.path)
    return (
      <div key={node.path}>
        {isRenaming ? (
          <InlineInput initial={node.name} depth={depth} isDir={isDir} onDone={(v) => void finishEdit(v)} />
        ) : (
          <div
            role="treeitem"
            aria-expanded={isDir ? open : undefined}
            aria-selected={selected}
            tabIndex={-1}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-localcode-path', node.path)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (!isDir) return
              e.preventDefault()
              setDropTarget(node.path)
            }}
            onDragLeave={() => setDropTarget((t) => (t === node.path ? null : t))}
            onDrop={(e) => isDir && void onDrop(e, node.path)}
            onClick={() => {
              useApp.setState({ selectedPath: node.path })
              if (isDir) store.toggleExpanded(node.path)
              else void store.openFile(node.path)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              useApp.setState({ selectedPath: node.path })
              setMenu({ x: e.clientX, y: e.clientY, node })
            }}
            title={node.truncated ? `${node.name} (not scanned — large generated folder)` : relativePath(workspace, node.path)}
            className={`flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-ui ${
              dropTarget === node.path ? 'bg-selected-focus' : selected ? 'bg-selected' : isActive ? 'bg-hover' : 'hover:bg-hover'
            } ${node.truncated ? 'opacity-60' : ''}`}
            style={{ paddingLeft: 8 + depth * 8 }}
          >
            <span className="flex w-4 justify-center text-muted">{isDir && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</span>
            <FileIcon name={node.name} isDir={isDir} open={open} />
            <span className="truncate">{node.name}</span>
          </div>
        )}
        {isDir && open && (
          <div role="group">
            {editing && editing.mode !== 'rename' && samePath(editing.parent, node.path) && (
              <InlineInput initial="" depth={depth + 1} isDir={editing.mode === 'newFolder'} onDone={(v) => void finishEdit(v)} />
            )}
            {node.children?.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (!workspace || !tree) {
    return (
      <div className="flex h-full flex-col">
        <SectionHeader title="Explorer" />
        <EmptyState icon={FolderOpen} title="No folder opened">
          <p className="mb-3">Open a folder to browse files, run code and let the assistant write into your project.</p>
          <div className="flex flex-col gap-2">
            <Button icon={FolderOpen} onClick={() => void store.openFolder()}>
              Open Folder
            </Button>
            <Button variant="secondary" icon={Upload} onClick={() => void importZip()}>
              Import Project from ZIP
            </Button>
          </div>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="Explorer">
        <IconButton icon={FilePlus} label="New File" onClick={() => startNew('newFile')} />
        <IconButton icon={FolderPlus} label="New Folder" onClick={() => startNew('newFolder')} />
        <IconButton icon={RefreshCw} label="Refresh Explorer" onClick={() => void store.refreshTree()} />
        <IconButton icon={ListCollapse} label="Collapse Folders" onClick={() => useApp.setState({ expanded: { [workspace]: true } })} />
        <IconButton icon={Upload} label="Import ZIP into workspace" onClick={() => void importZip()} />
        <IconButton icon={FileArchive} label="Export workspace as ZIP" onClick={() => void exportZip()} />
        <IconButton icon={X} label="Close Folder" onClick={() => void store.closeWorkspace()} />
      </SectionHeader>
      <div
        role="tree"
        aria-label="Files"
        className="min-h-0 flex-1 overflow-auto pb-6"
        onDragOver={(e) => {
          e.preventDefault()
          setDropTarget(workspace)
        }}
        onDrop={(e) => void onDrop(e, workspace)}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, node: tree })
          }
        }}
      >
        <div
          className="flex h-[22px] cursor-pointer items-center gap-1 pl-1 text-ui-xs font-bold uppercase"
          onClick={() => store.toggleExpanded(workspace)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, node: tree })
          }}
        >
          {expanded[workspace] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="truncate">{tree.name}</span>
        </div>
        {expanded[workspace] && (
          <>
            {editing && editing.mode !== 'rename' && samePath(editing.parent, workspace) && (
              <InlineInput initial="" depth={0} isDir={editing.mode === 'newFolder'} onDone={(v) => void finishEdit(v)} />
            )}
            {tree.children?.map((c) => renderNode(c, 0))}
          </>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.node)} onClose={() => setMenu(null)} />}
    </div>
  )
}
