import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import type { OllamaModel, OllamaRunning, OllamaStatus, PullProgress } from '../../shared/types'

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
}

export interface ChatOptions {
  model: string
  messages: OllamaChatMessage[]
  options?: Record<string, unknown>
  keepAlive?: string | number
  think?: boolean
  signal?: AbortSignal
  onToken?: (text: string) => void
  onThinking?: (text: string) => void
}

export class OllamaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

/** Thin client for the local Ollama REST API. No other inference backend is used. */
export class OllamaClient {
  private capCache = new Map<string, string[]>()

  constructor(public baseUrl: string) {}

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '')
    this.capCache.clear()
  }

  private url(p: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${p}`
  }

  private async json<T>(p: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(this.url(p), { ...init, signal: init?.signal ?? ctrl.signal })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        let msg = body
        try {
          msg = (JSON.parse(body) as { error?: string }).error ?? body
        } catch {
          /* not JSON */
        }
        throw new OllamaError(msg || `Ollama returned HTTP ${res.status}`, res.status)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(t)
    }
  }

  async version(): Promise<string> {
    const r = await this.json<{ version: string }>('/api/version', undefined, 3000)
    return r.version
  }

  async tags(): Promise<OllamaModel[]> {
    const r = await this.json<{
      models: Array<{
        name: string
        size: number
        modified_at: string
        details?: { family?: string; parameter_size?: string; quantization_level?: string }
      }>
    }>('/api/tags')
    return r.models.map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level
    }))
  }

  async ps(): Promise<OllamaRunning[]> {
    const r = await this.json<{
      models: Array<{ name: string; size: number; size_vram: number; expires_at: string }>
    }>('/api/ps')
    return (r.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      sizeVram: m.size_vram,
      expiresAt: m.expires_at
    }))
  }

  /** Model capabilities ("completion", "vision", "tools", "thinking"...), from /api/show when available. */
  async capabilities(model: string): Promise<string[]> {
    const cached = this.capCache.get(model)
    if (cached) return cached
    let caps: string[] = []
    try {
      const r = await this.json<{
        capabilities?: string[]
        details?: { families?: string[] | null }
        projector_info?: unknown
      }>('/api/show', { method: 'POST', body: JSON.stringify({ model }) })
      caps = r.capabilities ?? []
      if (!r.capabilities) {
        caps = ['completion']
        const fam = r.details?.families ?? []
        if (r.projector_info || fam.some((f) => /clip|mllama|vision/i.test(f))) caps.push('vision')
      }
    } catch {
      caps = /(vl|llava|vision|gemma3|minicpm-v|moondream)/i.test(model) ? ['completion', 'vision'] : ['completion']
    }
    this.capCache.set(model, caps)
    return caps
  }

  /** Embeddings via /api/embed (batch input). */
  async embed(model: string, input: string[], keepAlive = '5m'): Promise<number[][]> {
    const r = await this.json<{ embeddings: number[][] }>(
      '/api/embed',
      { method: 'POST', body: JSON.stringify({ model, input, keep_alive: keepAlive, truncate: true }) },
      120000
    )
    if (!Array.isArray(r.embeddings) || r.embeddings.length !== input.length) throw new OllamaError('Unexpected embedding response')
    return r.embeddings
  }

  async unload(model: string): Promise<void> {
    await this.json('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model, keep_alive: 0 })
    }, 15000)
  }

  async remove(model: string): Promise<void> {
    const res = await fetch(this.url('/api/delete'), { method: 'DELETE', body: JSON.stringify({ model }) })
    if (!res.ok) throw new OllamaError(`Could not delete ${model}: HTTP ${res.status}`)
  }

  async pull(model: string, onProgress: (p: PullProgress) => void, signal: AbortSignal): Promise<void> {
    const res = await fetch(this.url('/api/pull'), {
      method: 'POST',
      body: JSON.stringify({ model, stream: true }),
      signal
    })
    if (!res.ok || !res.body) throw new OllamaError(`Pull failed: HTTP ${res.status}`)
    await readNdjson(res.body, (obj) => {
      const o = obj as { status?: string; completed?: number; total?: number; error?: string }
      if (o.error) throw new OllamaError(o.error)
      onProgress({ model, status: o.status ?? '', completed: o.completed, total: o.total })
    })
    onProgress({ model, status: 'success', done: true })
  }

  /** Streaming chat. Resolves with the full assistant content once the stream finishes. */
  async chat(opts: ChatOptions): Promise<{ content: string; thinking: string; evalCount?: number }> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      stream: true,
      options: opts.options ?? {},
      keep_alive: opts.keepAlive ?? '10m'
    }
    if (opts.think !== undefined) body.think = opts.think
    let res: Response
    try {
      res = await fetch(this.url('/api/chat'), {
        method: 'POST',
        body: JSON.stringify(body),
        signal: opts.signal
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      throw new OllamaError(`Cannot reach Ollama at ${this.baseUrl}. Is it running?`)
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      let msg = text
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? text
      } catch {
        /* ignore */
      }
      // Retry once without "think" for models that do not support it.
      if (opts.think !== undefined && /think/i.test(msg)) {
        return this.chat({ ...opts, think: undefined })
      }
      throw new OllamaError(friendlyOllamaError(msg || `HTTP ${res.status}`, opts.model), res.status)
    }
    let content = ''
    let thinking = ''
    let evalCount: number | undefined
    await readNdjson(res.body, (obj) => {
      const o = obj as {
        message?: { content?: string; thinking?: string }
        error?: string
        done?: boolean
        eval_count?: number
      }
      if (o.error) throw new OllamaError(friendlyOllamaError(o.error, opts.model))
      const t = o.message?.thinking
      if (t) {
        thinking += t
        opts.onThinking?.(t)
      }
      const c = o.message?.content
      if (c) {
        content += c
        opts.onToken?.(c)
      }
      if (o.done) evalCount = o.eval_count
    })
    return { content, thinking, evalCount }
  }

  /** Non-streaming helper for short internal tasks (summaries, image descriptions). */
  async complete(model: string, messages: OllamaChatMessage[], options: Record<string, unknown>, signal?: AbortSignal, keepAlive?: string): Promise<string> {
    const r = await this.chat({ model, messages, options, signal, keepAlive })
    return r.content
  }
}

function friendlyOllamaError(msg: string, model: string): string {
  if (/not found|pull/i.test(msg) && /model/i.test(msg)) {
    return `Model "${model}" is not installed in Ollama. Download it from Settings → Models, or pick another model.`
  }
  if (/out of memory|cudaMalloc|insufficient memory|requires more system memory/i.test(msg)) {
    return `Ollama ran out of memory loading "${model}". Switch to Lite mode, choose a smaller model, or reduce the context size in Settings. (${msg})`
  }
  return msg
}

async function readNdjson(body: ReadableStream<Uint8Array>, onObj: (o: unknown) => void): Promise<void> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line) onObj(JSON.parse(line))
    }
  }
  const rest = buf.trim()
  if (rest) onObj(JSON.parse(rest))
}

/** Locate an installed Ollama binary without assuming it is on PATH. */
export function findOllamaBinary(): string | null {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    candidates.push(path.join(local, 'Programs', 'Ollama', 'ollama.exe'))
    candidates.push('C:\\Program Files\\Ollama\\ollama.exe')
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Ollama.app/Contents/Resources/ollama',
      path.join(os.homedir(), 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'),
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama'
    )
  } else {
    candidates.push('/usr/local/bin/ollama', '/usr/bin/ollama', path.join(os.homedir(), '.local', 'bin', 'ollama'))
  }
  for (const c of candidates) if (fs.existsSync(c)) return c
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(cmd, ['ollama'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    const first = out.split(/\r?\n/).find(Boolean)
    if (first && fs.existsSync(first.trim())) return first.trim()
  } catch {
    /* not on PATH */
  }
  return null
}

/** Start `ollama serve` in the background if the binary exists. Returns false when not installed. */
export function startOllamaServer(): boolean {
  const bin = findOllamaBinary()
  if (!bin) return false
  const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return true
}

export async function getStatus(client: OllamaClient): Promise<OllamaStatus> {
  const installedPath = findOllamaBinary()
  try {
    const version = await client.version()
    const [models, running] = await Promise.all([client.tags(), client.ps().catch(() => [])])
    await Promise.all(
      models.map(async (m) => {
        m.capabilities = await client.capabilities(m.name)
      })
    )
    return { connected: true, url: client.baseUrl, version, installedPath, models, running }
  } catch (e) {
    return {
      connected: false,
      url: client.baseUrl,
      error: (e as Error).name === 'AbortError' ? 'Connection timed out' : (e as Error).message,
      installedPath,
      models: [],
      running: []
    }
  }
}
