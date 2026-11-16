/**
 * Validation for shell commands proposed by the AI (run_command actions).
 * Commands are never passed to a shell as a raw string: they are tokenized,
 * checked against an allowlist, and spawned with an argv array.
 */

export const ALLOWED_EXECUTABLES = new Set([
  'python',
  'python3',
  'py',
  'pip',
  'pip3',
  'node',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'tsc',
  'tsx',
  'deno',
  'bun',
  'g++',
  'gcc',
  'clang',
  'clang++',
  'make',
  'cmake',
  'javac',
  'java',
  'mvn',
  'gradle',
  'go',
  'cargo',
  'rustc',
  'dotnet',
  'git',
  'pytest',
  'flask',
  'uvicorn'
])

// Executables that are Windows batch shims and therefore need cmd.exe to launch.
export const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'tsc', 'tsx', 'gradle', 'mvn', 'flask', 'pytest', 'uvicorn'])

const SHELL_META = /[|&;<>`$(){}\n\r]/

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /^git\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force|push\s+-f)/i,
  /^git\s+checkout\s+--\s/i,
  /\b(rm|rmdir|del|erase|format|mkfs|shutdown|reboot)\b/i,
  /^npm\s+(publish|unpublish)/i,
  /^pip3?\s+uninstall/i,
  /^npm\s+(uninstall|remove|rm)\b/i
]

export interface ParsedCommand {
  argv: string[]
  executable: string
  destructive: boolean
}

/** Minimal POSIX-like tokenizer supporting single and double quotes. */
export function tokenize(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let had = false
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      had = true
      continue
    }
    if (/\s/.test(ch)) {
      if (cur || had) out.push(cur)
      cur = ''
      had = false
      continue
    }
    cur += ch
  }
  if (quote) throw new Error('Unterminated quote in command')
  if (cur || had) out.push(cur)
  return out
}

export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim()
  if (!trimmed) throw new Error('Empty command')
  if (trimmed.length > 2000) throw new Error('Command is too long')
  if (SHELL_META.test(trimmed)) {
    throw new Error(
      'Shell operators (| & ; < > ` $ ( ) { }) are not allowed. Propose one command per run_command action.'
    )
  }
  const argv = tokenize(trimmed)
  const exeRaw = argv[0] ?? ''
  const executable = exeRaw.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  if (!ALLOWED_EXECUTABLES.has(executable)) {
    throw new Error(
      `"${exeRaw}" is not on the command allowlist. Allowed: ${[...ALLOWED_EXECUTABLES].join(', ')}`
    )
  }
  const destructive = DESTRUCTIVE_PATTERNS.some((re) => re.test(trimmed))
  return { argv, executable, destructive }
}
