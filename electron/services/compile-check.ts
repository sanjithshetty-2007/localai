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

const LEETCODE_TREE = 'struct TreeNode { int val; TreeNode *left; TreeNode *right; TreeNode() : val(0), left(nullptr), right(nullptr) {} TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} TreeNode(int x, TreeNode *l, TreeNode *r) : val(x), left(l), right(r) {} };\n'
const LEETCODE_LIST = 'struct ListNode { int val; ListNode *next; ListNode() : val(0), next(nullptr) {} ListNode(int x) : val(x), next(nullptr) {} ListNode(int x, ListNode *n) : val(x), next(n) {} };\n'

/** C/C++ source with comments removed (strings are rare in these snippets). */
export function stripCppComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

/**
 * LeetCode-style answers (a `class Solution`) rely on the judge's environment: all standard
 * headers plus TreeNode/ListNode definitions that the snippet keeps in a comment. Supply the
 * same environment for the compile check, so valid LeetCode code is not reported as broken.
 */
export function withLeetCodePrelude(src: string): string {
  const code = stripCppComments(src)
  if (!/\bclass\s+Solution\b/.test(code)) return src
  let pre = ''
  if (!/#\s*include/.test(code)) pre += '#include <bits/stdc++.h>\nusing namespace std;\n'
  if (/\bTreeNode\b/.test(code) && !/struct\s+TreeNode\s*\{/.test(code)) pre += LEETCODE_TREE
  if (/\bListNode\b/.test(code) && !/struct\s+ListNode\s*\{/.test(code)) pre += LEETCODE_LIST
  return pre ? `${pre}${src}` : src
}

/** Remove a top-level main() by matching braces. */
export function removeMain(src: string): string {
  const m = /\bint\s+main\s*\([^)]*\)\s*\{/.exec(src)
  if (!m) return src
  let depth = 0
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(0, m.index) + src.slice(i + 1)
  }
  return src.slice(0, m.index)
}

export function hasMain(src: string): boolean {
  return /\bint\s+main\s*\(/.test(stripCppComments(src))
}

/** Plain-language description of a failing exit code (Windows NTSTATUS crash codes included). */
export function describeExit(code: number | null): string {
  const map: Record<number, string> = {
    3221225477: 'crashed: invalid memory access (null or dangling pointer, out-of-range index)',
    3221225725: 'crashed: stack overflow (runaway recursion)',
    3221226505: 'crashed: aborted (failed assert or uncaught exception)',
    3221225620: 'crashed: integer division by zero',
    134: 'crashed: aborted (failed assert)',
    139: 'crashed: invalid memory access'
  }
  return code != null && map[code] ? map[code] : `exited with code ${code}`
}

export interface RunReport {
  ran: boolean
  ok: boolean
  output: string
  reason?: string
}

/**
 * Compile and run a single C++ solution with a test main() in a private temp folder
 * (10-second limit). Used only when the user has enabled "Test code by running it".
 */
export async function runCppTest(solution: string, testMain: string | null, timeoutMs = 10000): Promise<RunReport> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localcode-test-'))
  try {
    const body = testMain ? `${withLeetCodePrelude(removeMain(solution))}\n#include <cassert>\n${testMain}\n` : withLeetCodePrelude(solution)
    const src = path.join(dir, 'test.cpp')
    const exe = path.join(dir, process.platform === 'win32' ? 'test.exe' : 'test')
    fs.writeFileSync(src, body)
    const c = await run('g++', ['-std=c++17', '-O1', '-o', exe, src], dir)
    if (c.missing) return { ran: false, ok: false, output: '', reason: 'g++ not installed' }
    if (!c.ok) return { ran: true, ok: false, output: c.out.slice(0, 3000), reason: 'test program did not compile' }
    const r = await new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
      execFile(exe, [], { cwd: dir, timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
        resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: `${stdout}${stderr}`.slice(-3000), timedOut: !!e?.killed })
      })
    })
    if (r.timedOut) return { ran: true, ok: false, output: r.out, reason: `did not finish within ${timeoutMs / 1000}s (infinite loop?)` }
    if (r.code !== 0) return { ran: true, ok: false, output: r.out, reason: describeExit(r.code) }
    return { ran: true, ok: true, output: r.out }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.lang === 'cpp' ? withLeetCodePrelude(f.content) : f.content)
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
