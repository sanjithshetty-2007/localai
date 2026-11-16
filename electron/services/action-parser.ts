import { z } from 'zod'
import type { FileAction } from '../../shared/types'

// ---------- JSON schemas for every operation ----------

const relPath = z.string().min(1).max(500)

export const FileActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_file'), path: relPath, content: z.string().max(2_000_000) }),
  z.object({ type: z.literal('edit_file'), path: relPath, content: z.string().max(2_000_000) }),
  z.object({ type: z.literal('delete_file'), path: relPath }),
  z.object({ type: z.literal('rename_file'), from: relPath, to: relPath }),
  z.object({ type: z.literal('create_directory'), path: relPath }),
  z.object({ type: z.literal('run_command'), command: z.string().min(1).max(2000), cwd: relPath.optional() }),
  z.object({ type: z.literal('read_file'), path: relPath }),
  z.object({ type: z.literal('search_files'), query: z.string().min(1).max(200) })
])

export const READ_ONLY_TYPES = new Set(['read_file', 'search_files'])

// ---------- Parsing the model output ----------

const FENCE = /^([ \t]*)(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)\n\1\2[ \t]*$/gm
const FILE_ATTR = /(?:^|\s)(?:file|path|filename|title)\s*[=:]\s*["']?([^"'\s]+)["']?/i
const HEADER_FILE = /^(?:#{1,6}\s*|\*\*|__)?\s*(?:(?:file(?:name)?|path|create|update|edit)\s*[:=-]?\s*)?`?([\w./\\-]+\.[A-Za-z0-9]{1,8})`?\s*(?:\*\*|__)?\s*:?\s*$/i
// A markdown heading or bold line that ends with a source file name: "### Header File: `tree.h`", "**Source (main.c)**".
const LABELLED_FILE = /^(?:#{1,6}\s+|\*\*|__|\d+\.\s+\*\*)[^\n]*?[`(\s:]([\w./\\-]+\.(?:c|h|cpp|cc|cxx|hpp|java|py|js|mjs|ts|tsx|jsx|html|css|json|md|txt|sql|go|rs|rb|php|cs|kt|swift|sh|yml|yaml|toml))[`)]?\s*(?:\*\*|__)?\s*:?\s*$/i
const FILE_EXT = '(?:c|h|cpp|cc|cxx|hpp|java|py|js|mjs|cjs|ts|tsx|jsx|html|css|scss|json|md|txt|sql|go|rs|rb|php|cs|kt|swift|sh|ps1|yml|yaml|toml|xml|ini|env)'
const FIRST_LINE_FILE = new RegExp(`^\\s*(?:\\/\\/|#|\\/\\*|<!--|--|;)\\s*(?:(?:file(?:name)?|path)\\s*[:=]\\s*)?([\\w./\\\\-]+\\.${FILE_EXT})\\s*(?:\\*\\/|-->)?\\s*$`, 'i')
const EXPLICIT_HEADER = /(?:file(?:name)?|path)\s*[:=]/i

export interface ParsedOutput {
  actions: FileAction[]
  errors: string[]
}

/**
 * Turn the assistant's reply into structured actions. Two forms are recognised:
 *   ```python file=src/app.py   (full file content)        -> create_file / edit_file
 *   ```action {"type": "...", ...}                         -> any FileAction (validated)
 * A fenced block directly under a "File: path" line is also treated as a file.
 */
export function parseActions(text: string): ParsedOutput {
  const actions: FileAction[] = []
  const errors: string[] = []
  let m: RegExpExecArray | null
  FENCE.lastIndex = 0
  while ((m = FENCE.exec(text))) {
    const info = m[3].trim()
    const rawBody = m[4]
    const lang = info.split(/\s+/)[0]?.toLowerCase() ?? ''
    if (lang === 'action' || lang === 'actions' || lang === 'tool') {
      try {
        const parsed = JSON.parse(rawBody.trim()) as unknown
        const list = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of list) {
          const r = FileActionSchema.safeParse(item)
          if (r.success) actions.push(r.data as FileAction)
          else errors.push(`Ignored invalid action ${JSON.stringify(item).slice(0, 120)}: ${r.error.issues.map((i) => i.message).join('; ')}`)
        }
      } catch (e) {
        errors.push(`Could not parse action block: ${(e as Error).message}`)
      }
      continue
    }
    let filePath = FILE_ATTR.exec(info)?.[1]
    let body = rawBody
    if (!filePath) {
      // A first-line comment naming the file: `// file=src/tree.c`, `# filename: app.py`, `/* tree.h */`.
      const first = FIRST_LINE_FILE.exec(body.split('\n')[0] ?? '')
      if (first) {
        filePath = first[1]
        body = body.split('\n').slice(1).join('\n').replace(/^\n+/, '')
      }
    }
    if (!filePath) {
      // Look at the closest non-empty line above the fence.
      const before = text.slice(0, m.index).split(/\r?\n/)
      for (let i = before.length - 1, seen = 0; i >= 0 && seen < 2; i--) {
        const line = before[i].trim()
        if (!line) continue
        seen++
        const h = HEADER_FILE.exec(line)
        if (h && (EXPLICIT_HEADER.test(line) || /^#{1,6}\s|^\*\*|^`/.test(line))) {
          filePath = h[1]
        } else {
          const l = LABELLED_FILE.exec(line)
          if (l) filePath = l[1]
        }
        break
      }
    }
    if (filePath) {
      const content = body.endsWith('\n') ? body : body + '\n'
      actions.push({ type: 'create_file', path: filePath.replace(/\\/g, '/').replace(/^\.\//, ''), content })
    }
  }
  return { actions, errors }
}
