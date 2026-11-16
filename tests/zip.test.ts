import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createZip, safeExtractZip } from '../electron/filesystem/zip'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-zip-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

// Minimal ZIP writer so tests can create archives that yazl would refuse to build.
function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function rawZip(entries: Array<{ name: string; data: Buffer; deflate?: boolean; mode?: number }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name)
    const body = e.deflate ? zlib.deflateRawSync(e.data, { level: 9 }) : e.data
    const crc = crc32(e.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(e.deflate ? 8 : 0, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(e.data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    locals.push(lh, name, body)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE((3 << 8) | 20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(e.deflate ? 8 : 0, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(e.data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

describe('safe ZIP extraction', () => {
  it('round-trips a project through createZip and safeExtractZip', async () => {
    const src = path.join(tmp, 'src')
    fs.mkdirSync(path.join(src, 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(src, 'main.py'), 'print(1)\n')
    fs.writeFileSync(path.join(src, 'pkg', 'util.py'), 'X = 2\n')
    const zipFile = path.join(tmp, 'p.zip')
    expect(await createZip(src, zipFile)).toBe(2)
    const dest = path.join(tmp, 'out')
    const r = await safeExtractZip(zipFile, dest)
    expect(r.files).toBe(2)
    expect(fs.readFileSync(path.join(dest, 'pkg', 'util.py'), 'utf8')).toBe('X = 2\n')
  })

  it('rejects path traversal entries', async () => {
    const zipFile = path.join(tmp, 'evil.zip')
    fs.writeFileSync(zipFile, rawZip([{ name: '../escaped.txt', data: Buffer.from('pwned') }]))
    const dest = path.join(tmp, 'evil-out')
    await expect(safeExtractZip(zipFile, dest)).rejects.toThrow(/Unsafe path|invalid relative path/i)
    expect(fs.existsSync(path.join(tmp, 'escaped.txt'))).toBe(false)
  })

  it('rejects symlink entries', async () => {
    const zipFile = path.join(tmp, 'link.zip')
    fs.writeFileSync(zipFile, rawZip([{ name: 'link', data: Buffer.from('/etc/passwd'), mode: 0o120777 }]))
    await expect(safeExtractZip(zipFile, path.join(tmp, 'link-out'))).rejects.toThrow(/Symlink/)
  })

  it('rejects decompression bombs by ratio', async () => {
    const zipFile = path.join(tmp, 'bomb.zip')
    fs.writeFileSync(zipFile, rawZip([{ name: 'zeros.bin', data: Buffer.alloc(20 * 1024 * 1024), deflate: true }]))
    await expect(safeExtractZip(zipFile, path.join(tmp, 'bomb-out'))).rejects.toThrow(/ZIP bomb|ratio/i)
  })
})
