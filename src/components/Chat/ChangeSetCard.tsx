import { Check, CheckCircle2, Columns2, FilePlus2, FileEdit, FolderPlus, Loader2, Play, RotateCcw, Terminal, Trash2, ArrowRightLeft, X, XCircle, AlertTriangle } from 'lucide-react'
import type { ChangeItem, ChangeSet } from '@shared/types'
import { joinWs, useApp } from '@/store/app'
import { basename, RUNNABLE } from '@/lib/api'
import { Badge, Button, IconButton } from '../ui'

function itemIcon(i: ChangeItem) {
  switch (i.action.type) {
    case 'create_file':
      return FilePlus2
    case 'edit_file':
      return FileEdit
    case 'delete_file':
      return Trash2
    case 'rename_file':
      return ArrowRightLeft
    case 'create_directory':
      return FolderPlus
    default:
      return Terminal
  }
}

function itemLabel(i: ChangeItem): string {
  const a = i.action
  if (a.type === 'rename_file') return `${a.from} → ${a.to}`
  if (a.type === 'run_command') return a.command
  if ('path' in a) return a.path
  return a.type
}

const STATUS_TONE = { pending: 'info', applied: 'success', rejected: 'neutral', failed: 'error' } as const

export function ChangeSetCard({ cs, fixFile }: { cs: ChangeSet; fixFile?: string }) {
  const verification = useApp((s) => s.verifications[cs.id])
  const runId = useApp((s) => s.runId)
  const workspace = useApp((s) => s.workspace)
  const { applyChanges, rejectChanges, undoChanges, openDiff, applyAndRun, runPath, fixWithAI, confirm } = useApp.getState()
  const pending = cs.items.filter((i) => i.status === 'pending' || i.status === 'failed')
  const applied = cs.items.filter((i) => i.status === 'applied')
  const wrongWorkspace = workspace && workspace.toLowerCase() !== cs.workspace.toLowerCase()
  const fixInSet = fixFile && cs.items.some((i) => 'path' in i.action && joinWs(cs.workspace, i.action.path).toLowerCase() === fixFile.toLowerCase())
  const runnable = cs.items.find((i) => (i.action.type === 'create_file' || i.action.type === 'edit_file') && RUNNABLE.test(i.action.path) && i.status === 'applied')

  const acceptAll = async () => {
    const risky = pending.filter((i) => i.destructive || i.action.type === 'run_command')
    if (risky.length) {
      const ok = await confirm(
        'Confirm changes',
        `This includes ${risky.map((r) => (r.action.type === 'run_command' ? `running "${r.action.command}"` : r.action.type.replace('_', ' ') + ' ' + itemLabel(r))).join(', ')}. Commands run on your computer with your permissions. Continue?`,
        'Apply',
        true
      )
      if (!ok) return
    }
    await applyChanges(cs.id, pending.map((i) => i.id))
  }

  const acceptOne = async (i: ChangeItem) => {
    if (i.destructive || i.action.type === 'run_command') {
      const what = i.action.type === 'run_command' ? `Run "${i.action.command}" in the workspace? It runs with your user permissions.` : `${i.action.type === 'delete_file' ? 'Delete' : 'Rename'} ${itemLabel(i)}?`
      if (!(await confirm('Confirm', what, i.action.type === 'run_command' ? 'Run' : 'Apply', i.destructive))) return
    }
    await applyChanges(cs.id, [i.id])
  }

  return (
    <div className="mt-2 overflow-hidden rounded-[4px] border border-line-strong bg-sidebar">
      <div className="flex h-[28px] items-center gap-2 border-b border-line px-2 text-ui-sm">
        <span className="font-semibold text-fg-strong">Proposed changes</span>
        <span className="text-muted">
          {cs.items.length} item{cs.items.length === 1 ? '' : 's'}
          {applied.length ? ` · ${applied.length} applied` : ''}
        </span>
      </div>
      {wrongWorkspace && <div className="px-2 py-1 text-ui-xs text-warning">These changes belong to {cs.workspace}. Open that folder to apply them.</div>}
      <div className="py-0.5">
        {cs.items.map((i) => {
          const Icon = itemIcon(i)
          const isFile = i.action.type === 'create_file' || i.action.type === 'edit_file'
          const canAct = i.status === 'pending' || i.status === 'failed'
          return (
            <div key={i.id} className="group flex min-h-[24px] items-center gap-1.5 px-2 text-ui-sm hover:bg-hover">
              <Icon size={13} className={i.destructive ? 'shrink-0 text-warning' : 'shrink-0 text-muted'} />
              <button
                type="button"
                className={`min-w-0 flex-1 cursor-pointer truncate text-left ${i.action.type === 'run_command' ? 'font-mono' : ''} ${isFile ? 'hover:underline' : 'cursor-default'}`}
                title={i.error ?? itemLabel(i)}
                onClick={() => isFile && openDiff(cs, i.id)}
              >
                {itemLabel(i)}
              </button>
              {isFile && (
                <span className="shrink-0 text-ui-xs">
                  <span className="text-ins">+{i.added ?? 0}</span> <span className="text-del">−{i.removed ?? 0}</span>
                </span>
              )}
              <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
              {isFile && <IconButton icon={Columns2} size={13} label="Review diff" onClick={() => openDiff(cs, i.id)} />}
              {canAct && !wrongWorkspace && (
                <>
                  <IconButton icon={Check} size={13} label="Accept" onClick={() => void acceptOne(i)} />
                  <IconButton icon={X} size={13} label="Reject" onClick={() => void rejectChanges(cs.id, [i.id])} />
                </>
              )}
            </div>
          )
        })}
        {cs.items.some((i) => i.error) && (
          <div className="px-2 pb-1 text-ui-xs text-error">
            {cs.items
              .filter((i) => i.error)
              .map((i) => `${basename(itemLabel(i))}: ${i.error}`)
              .join(' · ')}
          </div>
        )}
        {cs.items.filter((i) => i.output).map((i) => (
          <pre key={i.id} className="selectable mx-2 mb-1 max-h-[120px] overflow-auto rounded-[2px] bg-code p-1.5 font-mono text-ui-xs whitespace-pre-wrap">
            {i.output}
          </pre>
        ))}
      </div>
      {verification && (
        <div className={`flex items-center gap-1.5 border-t border-line px-2 py-1 text-ui-sm ${verification.status === 'passed' ? 'text-success' : verification.status === 'failed' ? 'text-error' : 'text-muted'}`}>
          {verification.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : verification.status === 'passed' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {verification.status === 'running' && 'Verifying: running the program…'}
          {verification.status === 'passed' && `Verified: the program ran successfully (exit ${verification.exitCode ?? 0}).`}
          {verification.status === 'failed' && (
            <>
              <span>Still failing (exit {verification.exitCode ?? 'none'}).</span>
              {verification.attempt >= 3 ? (
                <span className="flex items-center gap-1 text-warning">
                  <AlertTriangle size={12} /> {verification.attempt} attempts — review the code manually.
                </span>
              ) : (
                <button type="button" className="cursor-pointer text-info underline" onClick={() => void fixWithAI()}>
                  Try another fix
                </button>
              )}
            </>
          )}
        </div>
      )}
      {!wrongWorkspace && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-1.5">
          {pending.length > 0 && (
            <>
              {fixInSet && fixFile ? (
                <Button size="sm" icon={Play} disabled={!!runId} onClick={() => void applyAndRun(cs.id, fixFile)}>
                  Accept & Re-run
                </Button>
              ) : null}
              <Button size="sm" variant={fixInSet ? 'secondary' : 'primary'} icon={Check} onClick={() => void acceptAll()}>
                Accept {pending.length > 1 ? 'All' : ''}
              </Button>
              <Button size="sm" variant="secondary" icon={X} onClick={() => void rejectChanges(cs.id, pending.map((i) => i.id))}>
                Reject {pending.length > 1 ? 'All' : ''}
              </Button>
            </>
          )}
          {applied.length > 0 && (
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void undoChanges(cs.id)}>
              Undo
            </Button>
          )}
          {runnable && 'path' in runnable.action && !fixInSet && (
            <Button size="sm" variant="secondary" icon={Play} disabled={!!runId} onClick={() => void runPath(joinWs(cs.workspace, (runnable.action as { path: string }).path))}>
              Run {basename((runnable.action as { path: string }).path)}
            </Button>
          )}
          {fixInSet && fixFile && applied.length > 0 && pending.length === 0 && !verification && (
            <Button size="sm" variant="secondary" icon={Play} disabled={!!runId} onClick={() => void applyAndRun(cs.id, fixFile)}>
              Re-run to verify
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
