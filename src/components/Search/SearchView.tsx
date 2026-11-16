import { useMemo, useRef, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, Regex, Search } from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { useApp } from '@/store/app'
import { api, basename, errorMessage, relativePath } from '@/lib/api'
import { EmptyState, IconButton, SectionHeader, Spinner, TextInput } from '../ui'
import { FileIcon } from '../fileIcon'

export function SearchView() {
  const workspace = useApp((s) => s.workspace)
  const { openFile } = useApp.getState()
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const seq = useRef(0)

  const run = async (q = query, r = regex, c = caseSensitive) => {
    const id = ++seq.current
    if (!q.trim()) {
      setHits(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.fs.search(q, { regex: r, caseSensitive: c })
      if (id === seq.current) setHits(res)
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e))
    } finally {
      if (id === seq.current) setBusy(false)
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, SearchHit[]>()
    for (const h of hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h])
    return [...m.entries()]
  }, [hits])

  if (!workspace) {
    return (
      <div className="flex h-full flex-col">
        <SectionHeader title="Search" />
        <EmptyState icon={Search} title="Open a folder to search its files" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="Search" />
      <div className="px-3 pb-2">
        <div className="relative">
          <TextInput
            autoFocus
            placeholder="Search"
            value={query}
            className="pr-14"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run()}
          />
          <div className="absolute top-[2px] right-1 flex">
            <IconButton icon={CaseSensitive} label="Match Case" active={caseSensitive} onClick={() => { setCaseSensitive(!caseSensitive); void run(query, regex, !caseSensitive) }} />
            <IconButton icon={Regex} label="Use Regular Expression" active={regex} onClick={() => { setRegex(!regex); void run(query, !regex, caseSensitive) }} />
          </div>
        </div>
        <div className="mt-1 h-4 text-ui-xs text-muted">
          {busy ? <Spinner size={12} /> : error ? <span className="text-error">{error}</span> : hits ? `${hits.length} result${hits.length === 1 ? '' : 's'} in ${grouped.length} file${grouped.length === 1 ? '' : 's'}${hits.length >= 2000 ? ' (limit reached)' : ''}` : 'Press Enter to search. Use Ctrl+H in the editor to replace.'}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-4">
        {grouped.map(([file, list]) => (
          <div key={file}>
            <div className="flex h-[22px] cursor-pointer items-center gap-1 pl-2 text-ui hover:bg-hover" onClick={() => setCollapsed((c) => ({ ...c, [file]: !c[file] }))}>
              {collapsed[file] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <FileIcon name={basename(file)} />
              <span className="truncate">{basename(file)}</span>
              <span className="truncate text-ui-xs text-muted">{relativePath(workspace, file).split('/').slice(0, -1).join('/')}</span>
              <span className="mr-2 ml-auto rounded-[8px] bg-badge px-1.5 text-ui-xs">{list.length}</span>
            </div>
            {!collapsed[file] &&
              list.map((h, i) => (
                <div key={i} className="flex h-[22px] cursor-pointer items-center gap-2 pr-2 pl-9 text-ui hover:bg-hover" onClick={() => void openFile(h.path, h.line)} title={`Line ${h.line}`}>
                  <span className="w-8 shrink-0 text-right text-ui-xs text-muted">{h.line}</span>
                  <span className="truncate font-mono text-ui-sm">{h.text.trim()}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
