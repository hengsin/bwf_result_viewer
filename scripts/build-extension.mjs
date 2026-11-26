import { execFileSync } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const outDir = resolve(rootDir, 'dist-extension')
const viteBin = resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')

execFileSync(process.execPath, [viteBin, 'build', '--mode', 'extension'], {
  cwd: rootDir,
  stdio: 'inherit',
})

await cp(resolve(rootDir, 'extension/manifest.json'), resolve(outDir, 'manifest.json'))
await cp(resolve(rootDir, 'extension/service-worker.js'), resolve(outDir, 'service-worker.js'))
await mkdir(resolve(outDir, 'icons'), { recursive: true })
await cp(resolve(rootDir, 'extension/icons'), resolve(outDir, 'icons'), { recursive: true })
await writeFile(resolve(outDir, '__bwf_config.js'), 'window.__BWF_INITIAL_URL__ = "";\n', 'utf8')

console.log(`Chrome extension built at ${outDir}`)
