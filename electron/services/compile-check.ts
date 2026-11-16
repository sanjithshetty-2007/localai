import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseActions } from './action-parser'
import { isMacPlaceholder } from '../platform/mac-tools'

/*
 * Compile-only verification of code the model wrote. Files are written to a private temp
 * folder and checked with the compiler's syntax/type checker; nothing is executed.
 */

export interface CodeFile {
  name: string
  lang: 'c' | 'cpp' | 'java' | 'python'
  content: string
}

const EXT_LANG: Record<string, CodeFile['lang']> = { c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', java: 'java', py: 'python' }
const FENCE_LANG: Record<string, CodeFile['lang']> = { c: 'c', cpp: 'cpp', 'c++': 'cpp', java: 'java', python: 'python', py: 'python' }
const FENCE = /^([ \t]*)(`{3,})([^\n`]*)\n([\s\S]*?)\n\1\2[ \t]*$/gm

/** Named files (file= or labelled headings) plus unnamed code blocks in a checkable language. */
export function collectCodeFiles(text: string): CodeFile[] {
  const files = new Map<string, CodeFile>()
  for (const a of parseActions(text).actions) {
    if (a.type !== 'create_file' && a.type !== 'edit_file') continue
    const ext = a.path.split('.').pop()?.toLowerCase() ?? ''
    const lang = EXT_LANG[ext]
    if (lang) files.set(path.basename(a.path), { name: path.basename(a.path), lang, content: a.content })
  }
  if (files.size) return [...files.values()]
  // No named files: check unnamed blocks of one language (the main answer), skipping short snippets.
  let m: RegExpExecArray | null
  let i = 0
  FENCE.lastIndex = 0
  while ((m = FENCE.exec(text))) {
    const lang = FENCE_LANG[m[3].trim().split(/\s+/)[0]?.toLowerCase() ?? '']
    const body = m[4].replace(new RegExp(`^${m[1]}`, 'gm'), '')
    if (!lang || body.split('\n').length < 4) continue
    const isJavaMain = lang === 'java' && /public\s+class\s+(\w+)/.exec(body)
    const name = lang === 'java' && isJavaMain ? `${isJavaMain[1]}.java` : `snippet${++i}.${lang === 'python' ? 'py' : lang}`
    files.set(name, { name, lang, content: body })
  }
  return [...files.values()]
}

function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string; missing: boolean }> {
  // macOS: a placeholder compiler would open an install dialog; treat it as not installed.
  if (isMacPlaceholder(cmd)) return Promise.resolve({ ok: false, out: '', missing: true })
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { cwd, timeout: 30000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
        const missing = !!err && (err as NodeJS.ErrnoException).code === 'ENOENT'
        resolve({ ok: !err, out: `${stdout}${stderr}`.trim(), missing })
      })
    } catch {
      resolve({ ok: false, out: '', missing: true })
    }
  })
}

export interface CompileReport {
  checked: string[] // languages actually compiled
  errors: string // compiler output for failures ('' when clean)
}

export async function compileCheck(files: CodeFile[], pythonCmd = process.platform === 'win32' ? 'python' : 'python3'): Promise<CompileReport> {
  const report: CompileReport = { checked: [], errors: '' }
  if (!files.length) return report
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localcode-check-'))
  try {
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.content)
    const errs: string[] = []
    const byLang = (l: CodeFile['lang']) => files.filter((f) => f.lang === l)

    const cFiles = byLang('c').filter((f) => f.name.endsWith('.c'))
    for (const f of cFiles) {
      const r = await run('gcc', ['-fsyntax-only', '-std=c11', '-Wall', '-Werror=implicit-function-declaration', '-Werror=return-type', '-I.', f.name], dir)
      if (r.missing) break
      if (!report.checked.includes('C')) report.checked.push('C')
      if (!r.ok) errs.push(r.out)
    }
    const cppFiles = byLang('cpp').filter((f) => !f.name.endsWith('.hpp') && !f.name.endsWith('.h'))
    for (const f of cppFiles) {
      const r = await run('g++', ['-fsyntax-only', '-std=c++17', '-Wall', '-Werror=return-type', '-I.', f.name], dir)
      if (r.missing) break
      if (!report.checked.includes('C++')) report.checked.push('C++')
      if (!r.ok) errs.push(r.out)
    }
    const javaFiles = byLang('java')
    if (javaFiles.length) {
      const r = await run('javac', ['-d', path.join(dir, 'classes'), ...javaFiles.map((f) => f.name)], dir)
      if (!r.missing) {
        report.checked.push('Java')
        if (!r.ok) errs.push(r.out)
      }
    }
    for (const f of byLang('python')) {
      const r = await run(pythonCmd, ['-m', 'py_compile', f.name], dir)
      if (r.missing) break
      if (!report.checked.includes('Python')) report.checked.push('Python')
      if (!r.ok) errs.push(r.out)
    }
    // Keep only error lines and their context; drop warnings-only noise.
    report.errors = errs
      .join('\n')
      .split('\n')
      .filter((l) => !/^\s*$/.test(l))
      .join('\n')
      .slice(0, 4000)
    return report
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
