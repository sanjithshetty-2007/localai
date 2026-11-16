import os from 'node:os'
import { execFile } from 'node:child_process'
import type { GpuInfo, HardwareInfo, HardwareProfile } from '../../shared/types'

function run(cmd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? '' : stdout)
    })
  })
}

async function detectNvidia(): Promise<GpuInfo[]> {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, mem] = l.split(',').map((s) => s.trim())
      const mib = Number(mem)
      return { name, vramGB: Number.isFinite(mib) ? Math.round((mib / 1024) * 10) / 10 : null, source: 'nvidia-smi' }
    })
}

async function detectGpus(): Promise<{ gpus: GpuInfo[]; notes: string[] }> {
  const notes: string[] = []
  const nvidia = await detectNvidia()
  const gpus: GpuInfo[] = [...nvidia]
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)|$($_.AdapterRAM)" }'
    ], 8000)
    for (const line of out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const [name, ram] = line.split('|')
      if (gpus.some((g) => g.name === name)) continue
      const bytes = Number(ram)
      // Win32_VideoController.AdapterRAM is a 32-bit field and caps at 4 GB, so it is only a lower bound.
      gpus.push({
        name,
        vramGB: Number.isFinite(bytes) && bytes > 0 ? Math.round((bytes / 1073741824) * 10) / 10 : null,
        source: 'WMI (may under-report above 4 GB)'
      })
    }
  } else if (process.platform === 'darwin') {
    const out = await run('system_profiler', ['SPDisplaysDataType'], 8000)
    const names = [...out.matchAll(/Chipset Model:\s*(.+)/g)].map((m) => m[1].trim())
    for (const name of names) {
      const appleSilicon = /Apple M/i.test(name)
      gpus.push({ name, vramGB: null, source: appleSilicon ? 'unified memory (shared with system RAM)' : 'system_profiler' })
      if (appleSilicon) notes.push('Apple Silicon uses unified memory: models share system RAM with the GPU.')
    }
  } else {
    const out = await run('lspci', [])
    for (const line of out.split(/\r?\n/).filter((l) => /VGA|3D controller/i.test(l))) {
      const name = line.replace(/^.*?:\s*/, '').trim()
      if (!gpus.some((g) => name.includes(g.name))) gpus.push({ name, vramGB: null, source: 'lspci (VRAM unknown)' })
    }
  }
  if (gpus.length === 0) notes.push('No GPU could be detected. Ollama will run models on the CPU.')
  if (nvidia.length === 0 && gpus.some((g) => g.vramGB === null)) {
    notes.push('VRAM could not be measured precisely on this system. Choose a profile manually if the recommendation looks wrong.')
  }
  return { gpus, notes }
}

export async function detectHardware(): Promise<HardwareInfo> {
  const { gpus, notes } = await detectGpus()
  const totalRamGB = Math.round((os.totalmem() / 1073741824) * 10) / 10
  const freeRamGB = Math.round((os.freemem() / 1073741824) * 10) / 10
  const bestVram = Math.max(0, ...gpus.map((g) => (g.source === 'nvidia-smi' ? g.vramGB ?? 0 : 0)))
  const appleUnified = gpus.some((g) => /unified/.test(g.source))

  let recommended: HardwareProfile = 'lite'
  if (appleUnified) recommended = totalRamGB >= 32 ? 'deep' : totalRamGB >= 16 ? 'balanced' : 'lite'
  else if (bestVram >= 12 && totalRamGB >= 32) recommended = 'deep'
  else if (bestVram >= 7) recommended = 'balanced'
  else if (bestVram === 0 && totalRamGB >= 32) recommended = 'balanced'
  notes.push(
    'Recommendations are estimates. Actual speed depends on quantization, context size, Ollama version and GPU architecture.'
  )
  return {
    platform: `${process.platform} ${os.release()}`,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? 'Unknown CPU',
    cpuCores: os.cpus().length,
    totalRamGB,
    freeRamGB,
    gpus,
    recommendedProfile: recommended,
    notes
  }
}
