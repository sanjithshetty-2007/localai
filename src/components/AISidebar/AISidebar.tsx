import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BookOpen,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  FileArchive,
  FileCode2,
  FileText,
  History,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  RefreshCw,
  Square,
  Trash2,
  User,
  X
} from 'lucide-react'
import type { Attachment, ChatMessage } from '@shared/types'
import { useApp } from '@/store/app'
import { api, basename, formatBytes } from '@/lib/api'
import { Button, IconButton, Spinner } from '../ui'
import { Markdown } from '../Chat/Markdown'
import { ChangeSetCard } from '../Chat/ChangeSetCard'

function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const Icon = a.kind === 'pdf' ? FileText : a.kind === 'zip' ? FileArchive : FileCode2
  const detail = a.kind === 'pdf' ? `${a.pages} pages` : a.kind === 'zip' ? `${a.fileCount ?? 0} files extracted` : a.kind === 'text' ? `${a.chars ?? 0} chars` : formatBytes(a.size)
  return (
    <div className="flex max-w-full items-center gap-1.5 rounded-[4px] border border-line-strong bg-editor py-0.5 pr-1 pl-1 text-ui-xs" title={`${a.name} · ${detail}${a.note ? ' · ' + a.note : ''}`}>
      {a.kind === 'image' && a.preview ? <img src={a.preview} alt="" className="h-[28px] w-auto max-w-[56px] rounded-[2px] object-cover" /> : <Icon size={14} className="shrink-0 text-muted" />}
      <span className="min-w-0">
        <span className="block max-w-[150px] truncate text-fg">{a.name}</span>
        <span className="block text-muted">{detail}</span>
      </span>
      {onRemove && <IconButton icon={X} size={12} label={`Remove ${a.name}`} onClick={onRemove} />}
    </div>
  )
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1 text-ui-xs text-muted">
      <button type="button" className="flex cursor-pointer items-center gap-0.5 hover:text-fg" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="selectable mt-1 ml-3 border-l border-line pl-2 whitespace-pre-wrap">{children}</div>}
    </div>
  )
}

const MessageView = memo(function MessageView({ m, isLast, fixFile }: { m: ChatMessage; isLast: boolean; fixFile?: string }) {
  const cs = useApp((s) => (m.meta?.changeSetId ? s.changeSets[m.meta.changeSetId] : undefined))
  const streaming = useApp((s) => !!s.stream)
  const { regenerate } = useApp.getState()
  if (m.role === 'user') {
    return (
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-ui-xs font-semibold text-fg">
          <User size={13} /> You {m.meta?.kind === 'fix-request' && <span className="font-normal text-muted">· fix request</span>}
        </div>
        <div className="rounded-[6px] bg-usermsg px-2.5 py-1.5">
          {m.attachments?.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {m.attachments.map((a) => (
                <AttachmentChip key={a.id} a={a} />
              ))}
            </div>
          ) : null}
          <div className="selectable text-ui whitespace-pre-wrap">{m.content}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="group px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-ui-xs">
        <Bot size={13} className="text-accent" />
        <span className="font-semibold text-fg">LocalCode AI</span>
        {m.meta?.models?.length ? <span className="truncate text-muted">{m.meta.models.join(' + ')}</span> : null}
        {m.meta?.durationMs ? <span className="text-muted">· {(m.meta.durationMs / 1000).toFixed(1)}s</span> : null}
        <div className="flex-1" />
        <span className="flex gap-0.5 opacity-0 group-hover:opacity-100">
          <IconButton icon={Copy} size={12} label="Copy response" onClick={() => void navigator.clipboard.writeText(m.content)} />
          {isLast && !streaming && <IconButton icon={RefreshCw} size={12} label="Regenerate response" onClick={() => void regenerate()} />}
        </span>
      </div>
      {m.meta?.thinking && <Collapsible title="Reasoning">{m.meta.thinking}</Collapsible>}
      {m.content && <Markdown text={m.content} />}
      {m.meta?.stopped && <div className="text-ui-xs text-muted italic">Generation stopped.</div>}
      {m.meta?.error && (
        <div className="mt-1 flex items-start gap-1.5 rounded-[4px] border border-error/40 bg-error/10 p-2 text-ui-sm">
          <AlertCircle size={14} className="mt-[1px] shrink-0 text-error" />
          <div className="min-w-0 flex-1">
            <div className="selectable">{m.meta.error}</div>
            {isLast && (
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void regenerate()}>
                  Retry
                </Button>
                <Button size="sm" variant="secondary" onClick={() => useApp.getState().openSettings()}>
                  Open Settings
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {cs && <ChangeSetCard cs={cs} fixFile={fixFile} />}
      {m.meta?.steps?.length ? <Collapsible title="Context & steps">{m.meta.steps.join('\n')}</Collapsible> : null}
    </div>
  )
})

function StreamingMessage() {
  const stream = useApp((s) => s.stream)
  // Throttle markdown re-rendering to animation frames while tokens stream in.
  const [text, setText] = useState('')
  useEffect(() => {
    const id = requestAnimationFrame(() => setText(stream?.content ?? ''))
    return () => cancelAnimationFrame(id)
  }, [stream?.content])
  if (!stream) return null
  return (
    <div className="px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-ui-xs">
        <Bot size={13} className="text-accent" />
        <span className="font-semibold text-fg">LocalCode AI</span>
      </div>
      {stream.thinking && <Collapsible title="Reasoning…">{stream.thinking}</Collapsible>}
      {text ? <Markdown text={text} streaming /> : null}
      {stream.status && (
        <div className="mt-1 flex items-center gap-1.5 text-ui-sm text-muted">
          <Loader2 size={13} className="animate-spin" /> {stream.status}
        </div>
      )}
    </div>
  )
}

function ConversationMenu({ onClose }: { onClose: () => void }) {
  const conversations = useApp((s) => s.conversations)
  const current = useApp((s) => s.conversationId)
  const { selectConversation, deleteConversation, confirm } = useApp.getState()
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])
  return (
    <div
      className="absolute top-[34px] right-2 left-2 z-30 max-h-[50vh] overflow-auto rounded-[4px] border border-line-strong bg-sidebar py-1 shadow-[0_4px_16px_var(--vs-shadow)]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {conversations.length === 0 && <div className="px-3 py-1 text-ui-sm text-muted">No conversations yet</div>}
      {conversations.map((c) => (
        <div
          key={c.id}
          className={`group flex h-[26px] cursor-pointer items-center gap-2 px-3 text-ui hover:bg-hover ${c.id === current ? 'bg-selected' : ''}`}
          onClick={() => {
            void selectConversation(c.id)
            onClose()
          }}
        >
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
          <span className="shrink-0 text-ui-xs text-muted">{new Date(c.updatedAt).toLocaleDateString()}</span>
          <IconButton
            icon={Trash2}
            size={12}
            label="Delete conversation"
            className="opacity-0 group-hover:opacity-100"
            onClick={async (e) => {
              e.stopPropagation()
              if (await confirm('Delete conversation', `Delete "${c.title}"? This cannot be undone.`, 'Delete', true)) void deleteConversation(c.id)
            }}
          />
        </div>
      ))}
    </div>
  )
}

function ChatInput() {
  const stream = useApp((s) => s.stream)
  const pending = useApp((s) => s.pendingAttachments)
  const attaching = useApp((s) => s.attaching)
  const focusTick = useApp((s) => s.chatInputFocusTick)
  const draft = useApp((s) => s.chatDraft)
  const workspace = useApp((s) => s.workspace)
  const activeName = useApp((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.kind === 'file' ? t.name : null
  })
  const selection = useApp((s) => s.selection)
  const libraryCount = useApp((s) => (s.settings?.knowledgeEnabled ? s.knowledgeDocs.filter((d) => d.enabled).length : 0))
  const { sendMessage, stopGeneration, pickAttachments, removeAttachment, addImageData, addAttachments } = useApp.getState()
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focusTick === 0) return
    if (draft) {
      setText(draft)
      useApp.setState({ chatDraft: '' })
    }
    setTimeout(() => ref.current?.focus(), 0)
  }, [focusTick, draft])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 220) + 'px'
  }, [text])

  const submit = () => {
    if (stream || attaching) return
    if (!text.trim() && !pending.length) return
    void sendMessage(text)
    setText('')
  }

  return (
    <div
      className="shrink-0 border-t border-line p-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const paths = [...e.dataTransfer.files].map((f) => api.fs.pathForFile(f)).filter(Boolean)
        void addAttachments(paths)
      }}
    >
      {(pending.length > 0 || attaching) && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {pending.map((a) => (
            <AttachmentChip key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
          ))}
          {attaching && (
            <span className="flex items-center gap-1 text-ui-xs text-muted">
              <Spinner size={12} /> Processing attachment…
            </span>
          )}
        </div>
      )}
      <div className="rounded-[4px] border border-input-border bg-input focus-within:border-focus">
        <textarea
          ref={ref}
          rows={2}
          value={text}
          spellCheck={false}
          aria-label="Message the assistant"
          placeholder="Ask anything, attach screenshots, PDFs, code or ZIPs… (Enter to send, Shift+Enter for a new line)"
          className="selectable block max-h-[220px] w-full resize-none bg-transparent px-2 pt-1.5 text-ui text-fg outline-none placeholder:text-muted"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            const items = [...e.clipboardData.items].filter((i) => i.type.startsWith('image/'))
            if (!items.length) return
            e.preventDefault()
            for (const it of items) {
              const file = it.getAsFile()
              if (!file) continue
              const reader = new FileReader()
              reader.onload = () => void addImageData(`pasted-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`, String(reader.result))
              reader.readAsDataURL(file)
            }
          }}
        />
        <div className="flex items-center gap-1 px-1 pb-1">
          <IconButton icon={Paperclip} label="Attach images, PDFs, code files or a ZIP" onClick={() => void pickAttachments()} />
          {libraryCount > 0 && (
            <button
              type="button"
              title={`Knowledge library: ${libraryCount} document(s) used as reference`}
              onClick={() => useApp.getState().setView('knowledge')}
              className="flex h-[20px] shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-1.5 text-ui-xs text-info hover:bg-hover"
            >
              <BookOpen size={12} /> {libraryCount}
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-ui-xs text-muted" title="Context the assistant will see">
            {activeName ? `${activeName}${selection?.text ? ` · lines ${selection.startLine}-${selection.endLine}` : ''}` : workspace ? basename(workspace) : 'No folder open'}
          </span>
          {stream ? (
            <button type="button" title="Stop generating" aria-label="Stop generating" onClick={() => void stopGeneration()} className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[4px] bg-button2 text-fg hover:bg-button2-hover">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              title="Send (Enter)"
              aria-label="Send"
              disabled={(!text.trim() && !pending.length) || attaching}
              onClick={submit}
              className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[4px] bg-button text-button-fg hover:bg-button-hover disabled:cursor-default disabled:opacity-40"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function AISidebar() {
  const messages = useApp((s) => s.messages)
  const stream = useApp((s) => s.stream)
  const ollama = useApp((s) => s.ollama)
  const conversations = useApp((s) => s.conversations)
  const conversationId = useApp((s) => s.conversationId)
  const { newConversation, clearConversation } = useApp.getState()
  const [menuOpen, setMenuOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const title = conversations.find((c) => c.id === conversationId)?.title ?? 'New chat'

  // Map each assistant reply to the file a preceding fix request was about.
  const fixFiles = useMemo(() => {
    const m: Record<string, string | undefined> = {}
    let last: string | undefined
    for (const msg of messages) {
      if (msg.role === 'user') last = msg.meta?.kind === 'fix-request' ? msg.meta.fixFile : undefined
      else m[msg.id] = last
    }
    return m
  }, [messages])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, stream?.content, stream?.status])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')

  return (
    <aside className="relative flex h-full min-w-0 flex-col bg-sidebar" aria-label="AI assistant">
      <div className="flex h-[35px] shrink-0 items-center gap-1 border-b border-line pr-1 pl-3">
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left text-ui-xs uppercase" onClick={() => setMenuOpen(!menuOpen)} title="Conversation history">
          <span className="shrink-0">Assistant</span>
          <span className="truncate text-muted normal-case">· {title}</span>
          <ChevronDown size={12} className="shrink-0" />
        </button>
        <IconButton icon={History} label="Conversation history" onClick={() => setMenuOpen(!menuOpen)} />
        <IconButton icon={MessageSquarePlus} label="New conversation" onClick={() => void newConversation()} />
        <IconButton icon={Trash2} label="Clear conversation" onClick={() => void clearConversation()} disabled={!messages.length} />
      </div>
      {menuOpen && <ConversationMenu onClose={() => setMenuOpen(false)} />}
      {ollama && !ollama.connected && (
        <div className="flex shrink-0 items-start gap-2 border-b border-line bg-warning/10 px-3 py-2 text-ui-sm">
          <AlertCircle size={14} className="mt-[1px] shrink-0 text-warning" />
          <div className="min-w-0">
            <div>Ollama is not reachable at {ollama.url}.</div>
            <div className="mt-1 flex gap-1.5">
              {ollama.installedPath && (
                <Button
                  size="sm"
                  onClick={async () => {
                    await api.ollama.start()
                    setTimeout(() => void useApp.getState().refreshOllama(), 2500)
                  }}
                >
                  Start Ollama
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => useApp.setState({ setupOpen: true })}>
                Setup
              </Button>
            </div>
          </div>
        </div>
      )}
      {ollama?.connected && ollama.models.length === 0 && (
        <div className="shrink-0 border-b border-line bg-info/10 px-3 py-2 text-ui-sm">
          No models installed yet.{' '}
          <button type="button" className="cursor-pointer text-info underline" onClick={() => useApp.setState({ setupOpen: true })}>
            Download one
          </button>
        </div>
      )}
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {messages.length === 0 && !stream && (
          <div className="px-4 py-6 text-ui-sm text-muted">
            <div className="mb-2 flex items-center gap-2 text-ui text-fg">
              <Bot size={18} className="text-accent" /> How can I help?
            </div>
            <p className="mb-2">I can answer questions, write and fix code in your workspace, run programs, read screenshots, PDFs and ZIP projects — all locally.</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>“Write a Python program to find prime numbers.”</li>
              <li>“Why is my program failing?” (after a run)</li>
              <li>Paste a screenshot with Ctrl+V and ask about it.</li>
              <li>Attach a PDF and ask “Solve question 2”.</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} m={m} isLast={m.id === lastAssistant?.id} fixFile={fixFiles[m.id]} />
        ))}
        <StreamingMessage />
      </div>
      <ChatInput />
    </aside>
  )
}
