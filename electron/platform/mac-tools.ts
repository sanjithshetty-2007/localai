import { execFileSync } from 'node:child_process'

/*
 * On macOS, /usr/bin/python3, gcc, g++, clang, git, javac and java are placeholders until
 * the Command Line Tools / a JDK are installed: merely running them opens a system
 * "install developer tools" or "install Java" dialog. Before probing such a tool we
 * check whether it is a placeholder and, if so, treat it as missing. No-op elsewhere.
 */

const CLT_SHIMS = new Set(['python3', 'python', 'gcc', 'g++', 'clang', 'clang++', 'cc', 'c++', 'make', 'git'])
const JAVA_SHIMS = new Set(['java', 'javac'])
const cache = new Map<string, boolean>()

function quiet(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/** True when `cmd` would only trigger a macOS install prompt instead of running. */
export function isMacPlaceholder(cmd: string): boolean {
  if (process.platform !== 'darwin') return false
  const name = cmd.split('/').pop() ?? cmd
  if (!CLT_SHIMS.has(name) && !JAVA_SHIMS.has(name)) return false
  if (cache.has(name)) return cache.get(name)!
  const resolved = quiet('/bin/sh', ['-c', `command -v ${name}`])
  let placeholder = false
  if (resolved === `/usr/bin/${name}`) {
    if (CLT_SHIMS.has(name)) placeholder = quiet('/usr/bin/xcode-select', ['-p']) === null
    else placeholder = quiet('/usr/libexec/java_home', []) === null
  }
  cache.set(name, placeholder)
  return placeholder
}
