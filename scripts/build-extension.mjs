import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const outDir = resolve(rootDir, 'dist-extension')
const viteBin = resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')

async function collectFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, baseDir)))
    } else if (entry.isFile()) {
      files.push({
        fullPath,
        zipPath: relative(baseDir, fullPath).replace(/\\/g, '/'),
      })
    }
  }
  return files.sort((a, b) => (a.zipPath < b.zipPath ? -1 : a.zipPath > b.zipPath ? 1 : 0))
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f)
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f)
  return { dosTime, dosDate }
}

/**
 * Create a standard PKZIP archive buffer from files inside `sourceDir` (using root-relative paths).
 */
async function createZipFromDirectory(sourceDir) {
  const files = await collectFiles(sourceDir)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const [rawData, fileStat] = await Promise.all([readFile(file.fullPath), stat(file.fullPath)])
    const nameBuf = Buffer.from(file.zipPath, 'utf8')
    const checksum = crc32(rawData) >>> 0
    const compressedRaw = deflateRawSync(rawData, { level: 9 })
    const useDeflate = compressedRaw.length < rawData.length
    const payload = useDeflate ? compressedRaw : rawData
    const method = useDeflate ? 8 : 0
    const { dosTime, dosDate } = toDosDateTime(fileStat.mtime)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(payload.length, 18)
    localHeader.writeUInt32LE(rawData.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuf, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8) // UTF-8 filename flag
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(payload.length, 20)
    centralHeader.writeUInt32LE(rawData.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBuf)
    offset += localHeader.length + nameBuf.length + payload.length
  }

  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDir, eocd])
}

const RESERVED_UNDERSCORE_DIRS = new Set(['_locales', '_metadata'])

async function assertNoReservedNames(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    const relPath = relative(baseDir, fullPath).replace(/\\/g, '/')
    if (
      entry.name.startsWith('_') &&
      !(entry.isDirectory() && dir === baseDir && RESERVED_UNDERSCORE_DIRS.has(entry.name))
    ) {
      throw new Error(`Invalid Chrome extension path "${relPath}": names starting with "_" are reserved by Chrome.`)
    }
    if (entry.isDirectory()) {
      await assertNoReservedNames(fullPath, baseDir)
    }
  }
}

execFileSync(process.execPath, [viteBin, 'build', '--mode', 'extension'], {
  cwd: rootDir,
  stdio: 'inherit',
})

await cp(resolve(rootDir, 'extension/manifest.json'), resolve(outDir, 'manifest.json'))
await cp(resolve(rootDir, 'extension/service-worker.js'), resolve(outDir, 'service-worker.js'))
await mkdir(resolve(outDir, 'icons'), { recursive: true })
await cp(resolve(rootDir, 'extension/icons'), resolve(outDir, 'icons'), { recursive: true })
await writeFile(resolve(outDir, 'bwf-config.js'), 'window.__BWF_INITIAL_URL__ = "";\n', 'utf8')
await assertNoReservedNames(outDir)

console.log(`Chrome extension built at ${outDir}`)

if (process.argv.includes('--zip')) {
  const manifest = JSON.parse(await readFile(resolve(rootDir, 'extension/manifest.json'), 'utf8'))
  const version = typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : '1.0.0'
  const zipPath = resolve(rootDir, `bwf-match-schedule-chrome-extension-${version}.zip`)
  const zipBuffer = await createZipFromDirectory(outDir)
  await writeFile(zipPath, zipBuffer)
  console.log(`Chrome extension zip created at ${zipPath}`)
}
