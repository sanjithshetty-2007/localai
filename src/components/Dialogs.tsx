import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useApp } from '@/store/app'
import { Button, IconButton, Modal, TextInput } from './ui'

function ConfirmDialog() {
  const req = useApp((s) => s.confirmReq)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (req) setTimeout(() => btn.current?.focus(), 0)
  }, [req])
  if (!req) return null
  return (
    <Modal
      title={req.title}
      onClose={() => req.resolve(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => req.resolve(false)}>
            Cancel
          </Button>
          <Button ref={btn} variant={req.danger ? 'danger' : 'primary'} onClick={() => req.resolve(true)}>
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="selectable text-fg">{req.message}</p>
    </Modal>
  )
}

function PromptDialog() {
  const req = useApp((s) => s.promptReq)
  const [value, setValue] = useState('')
  useEffect(() => {
    if (req) setValue(req.value)
  }, [req])
  if (!req) return null
  return (
    <Modal
      title={req.title}
      onClose={() => req.resolve(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => req.resolve(null)}>
            Cancel
          </Button>
          <Button disabled={!value.trim()} onClick={() => req.resolve(value.trim())}>
            OK
          </Button>
        </>
      }
    >
      <TextInput autoFocus value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && value.trim() && req.resolve(value.trim())} />
    </Modal>
  )
}

function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-3 bottom-8 z-50 flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-2 rounded-[4px] border border-line-strong bg-sidebar p-2.5 text-ui shadow-[0_4px_16px_var(--vs-shadow)]">
          {t.kind === 'error' ? <AlertCircle size={16} className="shrink-0 text-error" /> : t.kind === 'success' ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Info size={16} className="shrink-0 text-info" />}
          <span className="selectable min-w-0 flex-1 break-words">{t.text}</span>
          <IconButton icon={X} size={13} label="Dismiss" onClick={() => useApp.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))} />
        </div>
      ))}
    </div>
  )
}

export function Dialogs() {
  return (
    <>
      <ConfirmDialog />
      <PromptDialog />
      <Toasts />
    </>
  )
}
