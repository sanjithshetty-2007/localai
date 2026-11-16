// Pull Ollama models with progress logging and automatic retry when a download stalls.
// Usage: node scripts/pull-models.mjs model1 model2 ...
const base = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const models = process.argv.slice(2)
const STALL_MS = 60_000

async function pullOnce(model) {
  const ctrl = new AbortController()
  let last = Date.now()
  let lastLog = 0
  const watchdog = setInterval(() => {
    if (Date.now() - last > STALL_MS) ctrl.abort()
  }, 5000)
  try {
    const res = await fetch(`${base}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }), signal: ctrl.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let prevCompleted = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        const o = JSON.parse(line)
        if (o.error) throw new Error(o.error)
        if (o.completed !== prevCompleted || !o.completed) last = Date.now()
        prevCompleted = o.completed ?? prevCompleted
        if (Date.now() - lastLog > 15000 || o.status === 'success') {
          lastLog = Date.now()
          const pct = o.total ? ` ${((o.completed ?? 0) / o.total * 100).toFixed(1)}% of ${(o.total / 1e9).toFixed(2)} GB` : ''
          console.log(`${new Date().toLocaleTimeString()} ${model}: ${o.status}${pct}`)
        }
        if (o.status === 'success') return
      }
    }
    throw new Error('stream ended before success')
  } finally {
    clearInterval(watchdog)
  }
}

for (const m of models) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await pullOnce(m)
      console.log(`DONE ${m}`)
      break
    } catch (e) {
      console.log(`${new Date().toLocaleTimeString()} ${m}: ${e.name === 'AbortError' ? 'stalled' : e.message} — retry ${attempt}`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
console.log('ALL DONE')
