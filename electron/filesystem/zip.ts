import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { walkFiles } from './fs-service'

export const ZIP_LIMITS = {
  maxEntries: 20000,
  maxTotalBytes: 1024 * 1024 * 1024, // 1 GB uncompressed
  maxFileBytes: 200 * 1024 * 1024,
  maxRatio: 200 // uncompressed / compressed for any entry larger than 1 MB
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Extract a ZIP into destDir with protection against path traversal ("zip slip"),
 * symlink entries, oversized archives and decompression bombs. The uncompressed
 * byte count is measured while streaming, not trusted from the header.
 */
export function safeExtractZip(zipPath: string, destDir: string): Promise<{ files: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, strictFileNames: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open ZIP file'))
      let files = 0
      let entries = 0
      let total = 0
      let failed = false
      const fail = (e: Error) => {
        if (failed) return
        failed = true
        zip.close()
        reject(e)
      }

      zip.on('error', fail)
      zip.on('end', () => {
        if (!failed) resolve({ files, bytes: total })
      })
      zip.on('entry', (entry: yauzl.Entry) => {
        if (failed) return
        entries++
        if (entries > ZIP_LIMITS.maxEntries) return fail(new Error(`ZIP has more than ${ZIP_LIMITS.maxEntries} entries`))
        const name = entry.fileName.replace(/\\/g, '/')
        if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
          return fail(new Error(`Unsafe path in ZIP: ${entry.fileName}`))
        }
        if (name.split('/').some((p) => p === '__MACOSX')) return zip.readEntry()
        // Unix mode lives in the high 16 bits of externalFileAttributes; 0o120000 = symlink.
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        if (mode === 0o120000) return fail(new Error(`Symlinks are not allowed in ZIP: ${entry.fileName}`))

        const target = path.resolve(destDir, name)
        if (!isInside(destDir, target)) return fail(new Error(`Unsafe path in ZIP: ${entry.fileName}`))

        if (name.endsWith('/')) {
          fsp.mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail)
          return
        }
        if (entry.uncompressedSize > ZIP_LIMITS.maxFileBytes) {
          return fail(new Error(`File too large in ZIP: ${entry.fileName}`))
        }
        if (
          entry.uncompressedSize > 1024 * 1024 &&
          entry.compressedSize > 0 &&
          entry.uncompressedSize / entry.compressedSize > ZIP_LIMITS.maxRatio
        ) {
          return fail(new Error(`Suspicious compression ratio (possible ZIP bomb): ${entry.fileName}`))
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return fail(e2 ?? new Error('Could not read ZIP entry'))
          fsp
            .mkdir(path.dirname(target), { recursive: true })
            .then(() => {
              let written = 0
              const out = fs.createWriteStream(target)
              stream.on('data', (chunk: Buffer) => {
                written += chunk.length
                total += chunk.length
                if (written > ZIP_LIMITS.maxFileBytes || total > ZIP_LIMITS.maxTotalBytes) {
                  stream.destroy()
                  out.destroy()
                  fail(new Error('ZIP exceeds the extraction size limit'))
                }
              })
              stream.on('error', fail)
              out.on('error', fail)
              out.on('finish', () => {
                files++
                zip.readEntry()
              })
              stream.pipe(out)
            }, fail)
        })
      })
      zip.readEntry()
    })
  })
}

export async function createZip(sourceDir: string, outFile: string): Promise<number> {
  const zip = new yazl.ZipFile()
  let count = 0
  for await (const file of walkFiles(sourceDir, 50000)) {
    const rel = path.relative(sourceDir, file).split(path.sep).join('/')
    zip.addFile(file, rel)
    count++
  }
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outFile)
    out.on('close', () => resolve())
    out.on('error', reject)
    zip.outputStream.on('error', reject)
    zip.outputStream.pipe(out)
    zip.end()
  })
  return count
}
