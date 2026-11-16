import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, FileInput, FilePlus2, FileText } from 'lucide-react'
import { useApp } from '@/store/app'
import { basename, joinPath } from '@/lib/api'
import { IconButton } from '../ui'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string[] }
  data?: { meta?: string }
  children?: HastNode[]
}

function hastText(n: HastNode | undefined): string {
  if (!n) return ''
  if (n.type === 'text') return n.value ?? ''
  return (n.children ?? []).map(hastText).join('')
}

const FILE_META = /(?:^|\s)(?:file|path|filename|title)\s*[=:]\s*["']?([^"'\s]+)["']?/i

function CodeBlock({ language, filePath, code, children, streaming }: { language: string; filePath?: string; code: string; children: ReactNode; streaming?: boolean }) {
  const [copied, setCopied] = useState(false)
  const activeFile = useApp((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.kind === 'file' ? t : null
  })
  const selection = useApp((s) => s.selection)
  const workspace = useApp((s) => s.workspace)
  const { proposeEdit, prompt, toast } = useApp.getState()

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  const applyToActive = () => {
    if (!activeFile) return
    let next = code
    if (selection?.text && activeFile.content.includes(selection.text)) {
      next = activeFile.content.replace(selection.text, code.replace(/\n$/, ''))
    }
    void proposeEdit(activeFile.path, next)
  }
  const saveAsFile = async () => {
    if (!workspace) {
      toast('info', 'Open a folder first.')
      return
    }
    const ext = { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', cpp: 'cpp', c: 'c', html: 'html', css: 'css', json: 'json' }[language] ?? 'txt'
    const name = await prompt('Save code as file (relative to the workspace)', `untitled.${ext}`)
    if (name) void proposeEdit(joinPath(workspace, name), code)
  }

  return (
    <div className="my-2 overflow-hidden rounded-[4px] border border-line">
      <div className="flex h-[26px] items-center gap-1 border-b border-line bg-sidebar pr-1 pl-2 text-ui-xs text-muted">
        {filePath ? (
          <span className="flex min-w-0 items-center gap-1 text-fg" title={filePath}>
            <FileText size={12} /> <span className="truncate">{filePath}</span>
          </span>
        ) : (
          <span>{language || 'text'}</span>
        )}
        <div className="flex-1" />
        {!streaming && !filePath && activeFile && (
          <IconButton
            icon={FileInput}
            size={13}
            label={selection?.text ? `Apply: replace the selection in ${activeFile.name} (shows a diff first)` : `Apply: replace ${activeFile.name} with this code (shows a diff first)`}
            onClick={applyToActive}
          />
        )}
        {!streaming && !filePath && <IconButton icon={FilePlus2} size={13} label="Save as a new file…" onClick={() => void saveAsFile()} />}
        <IconButton icon={copied ? Check : Copy} size={13} label="Copy code" onClick={copy} />
      </div>
      <pre className="selectable overflow-x-auto bg-code p-2.5 font-mono text-[12.5px] leading-[1.45]">
        <code>{children}</code>
      </pre>
      {filePath && !streaming && <div className="border-t border-line bg-sidebar px-2 py-0.5 text-ui-xs text-muted">Proposed file · review it in the changes card below ({basename(filePath)})</div>}
    </div>
  )
}

function makeComponents(streaming: boolean): Components {
  return {
    pre({ node, children }) {
      const codeNode = (node as unknown as HastNode)?.children?.find((c) => c.tagName === 'code')
      if (!codeNode) return <pre>{children}</pre>
      const cls = codeNode.properties?.className?.find((c) => c.startsWith('language-')) ?? ''
      const language = cls.replace('language-', '')
      const meta = codeNode.data?.meta ?? ''
      const filePath = FILE_META.exec(meta)?.[1]
      const inner = (children as { props?: { children?: ReactNode } })?.props?.children ?? children
      if (language === 'action' || language === 'actions') {
        return (
          <div className="my-2 rounded-[4px] border border-line bg-sidebar px-2 py-1 font-mono text-ui-xs text-muted">
            <span className="text-info">action</span> {hastText(codeNode).trim().slice(0, 400)}
          </div>
        )
      }
      return (
        <CodeBlock language={language} filePath={filePath} code={hastText(codeNode)} streaming={streaming}>
          {inner}
        </CodeBlock>
      )
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      )
    }
  }
}

const finishedComponents = makeComponents(false)
const streamingComponents = makeComponents(true)

export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className={`md selectable text-ui ${streaming ? 'caret' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={streaming ? streamingComponents : finishedComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
