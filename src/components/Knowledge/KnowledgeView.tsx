import { useState } from 'react'
import { BookOpen, FilePlus2, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { KnowledgeHit } from '@shared/types'
import { useApp } from '@/store/app'
import { api, errorMessage, formatBytes } from '@/lib/api'
import { Badge, Button, EmptyState, IconButton, SectionHeader, Spinner, TextInput, Toggle } from '../ui'
import { FileIcon } from '../fileIcon'

export function KnowledgeView() {
  const docs = useApp((s) => s.knowledgeDocs)
  const progress = useApp((s) => s.knowledgeProgress)
  const enabled = useApp((s) => s.settings?.knowledgeEnabled ?? true)
  const embedModel = useApp((s) => s.settings?.roles.embedding ?? '')
  const { addKnowledge, loadKnowledge, updateSettings, confirm, toast } = useApp.getState()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [semantic, setSemantic] = useState(false)
  const [searching, setSearching] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const busy = Object.values(progress).some((p) => p.stage === 'extracting' || p.stage === 'embedding')

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const r = await api.knowledge.search(query)
      setHits(r.hits)
      setSemantic(r.semantic)
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div
      className={`flex h-full flex-col ${dragOver ? 'bg-selected-focus/30' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const paths = [...e.dataTransfer.files].map((f) => api.fs.pathForFile(f)).filter(Boolean)
        if (paths.length) void addKnowledge(paths)
      }}
    >
      <SectionHeader title="Knowledge">
        <IconButton icon={FilePlus2} label="Add documents (syllabus, notes…)" onClick={() => void addKnowledge()} />
        <IconButton
          icon={RefreshCw}
          label="Re-embed all documents"
          disabled={busy || !docs.length}
          onClick={async () => {
            await api.knowledge.reembed().catch((e) => toast('error', errorMessage(e)))
            void loadKnowledge()
          }}
        />
      </SectionHeader>
      <div className="px-4 pb-2">
        <Toggle checked={enabled} onChange={(v) => void updateSettings({ knowledgeEnabled: v })} label="Use library in chat" description="Relevant passages are added to every conversation as reference." />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {docs.length === 0 && !busy ? (
          <EmptyState icon={BookOpen} title="Your reference library is empty">
            <p className="mb-3">Add your syllabus, course outline or notes (PDF, DOCX, TXT, MD). They are processed and embedded locally with {embedModel || 'the embedding model'}, and the assistant uses them as reference in every chat.</p>
            <Button icon={FilePlus2} onClick={() => void addKnowledge()}>
              Add Syllabus or Notes
            </Button>
            <p className="mt-2">or drop files here</p>
          </EmptyState>
        ) : (
          <div className="pb-2">
            {docs.map((d) => {
              const p = progress[d.id]
              const working = p && (p.stage === 'extracting' || p.stage === 'embedding')
              const semanticReady = d.embedded >= d.chunks && d.chunks > 0
              return (
                <div key={d.id} className="group border-b border-line px-3 py-1.5 text-ui-sm">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Use ${d.name} as reference`}
                      title="Use as reference"
                      className="h-[13px] w-[13px] cursor-pointer accent-[var(--vs-accent)]"
                      checked={d.enabled}
                      onChange={async (e) => {
                        await api.knowledge.setEnabled(d.id, e.target.checked)
                        void loadKnowledge()
                      }}
                    />
                    <FileIcon name={d.name} size={14} />
                    <span className={`min-w-0 flex-1 truncate ${d.enabled ? 'text-fg' : 'text-muted line-through'}`} title={d.name}>
                      {d.name}
                    </span>
                    {d.id.startsWith('builtin-') ? (
                      <Badge tone="info">built-in</Badge>
                    ) : (
                    <IconButton
                      icon={Trash2}
                      size={13}
                      label={`Remove ${d.name}`}
                      className="opacity-0 group-hover:opacity-100"
                      onClick={async () => {
                        if (await confirm('Remove from library', `Remove "${d.name}" from the knowledge library? The original file is not touched.`, 'Remove', true)) {
                          await api.knowledge.remove(d.id)
                          void loadKnowledge()
                        }
                      }}
                    />
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-[19px] text-ui-xs text-muted">
                    <span>
                      {d.pages > 1 ? `${d.pages} pages · ` : ''}
                      {d.chunks} passages · {formatBytes(d.size)}
                    </span>
                    {working ? (
                      <span className="flex items-center gap-1">
                        <Spinner size={11} /> {p.stage === 'extracting' ? 'Reading…' : `Embedding ${p.done}/${p.total}`}
                      </span>
                    ) : semanticReady ? (
                      <Badge tone="success">semantic</Badge>
                    ) : (
                      <Badge tone="warning">keyword only</Badge>
                    )}
                  </div>
                  {d.error && !working && <div className="mt-0.5 pl-[19px] text-ui-xs text-warning">{d.error}</div>}
                </div>
              )
            })}
            {Object.values(progress)
              .filter((p) => p.stage === 'extracting' && !docs.some((d) => d.id === p.docId))
              .map((p) => (
                <div key={p.docId} className="flex items-center gap-1.5 px-3 py-1.5 text-ui-sm text-muted">
                  <Spinner size={12} /> Reading {p.name}…
                </div>
              ))}
          </div>
        )}

        {docs.length > 0 && (
          <div className="px-3 pt-2 pb-4">
            <div className="mb-1 text-ui-xs text-fg uppercase">Test retrieval</div>
            <div className="flex gap-1">
              <TextInput placeholder="e.g. topics in unit 3" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} />
              <IconButton icon={Search} label="Search the library" onClick={() => void search()} />
            </div>
            {searching && <Spinner className="mt-2" />}
            {hits && !searching && (
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="text-ui-xs text-muted">
                  {hits.length} passage{hits.length === 1 ? '' : 's'} · {semantic ? 'semantic + keyword' : 'keyword only'}
                </div>
                {hits.map((h, i) => (
                  <div key={i} className="rounded-[2px] border border-line bg-editor p-1.5 text-ui-xs">
                    <div className="mb-0.5 flex justify-between text-muted">
                      <span className="truncate">
                        {h.docName}
                        {h.page ? ` · p.${h.page}` : ' · section'}
                      </span>
                      {h.chunkId !== -1 && <span>{h.score.toFixed(2)}</span>}
                    </div>
                    <div className="selectable line-clamp-4 whitespace-pre-wrap text-fg">{h.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
