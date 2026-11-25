import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const viteBin = resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')

const mode = process.argv[2]
const rawArgs = process.argv.slice(3)

// Vite flags that consume the following argument as their value.
const flagsWithValue = new Set([
  '--host',
  '--port',
  '--open',
  '-c',
  '--config',
  '--base',
  '-l',
  '--logLevel',
  '--configLoader',
  '--profile',
  '-d',
  '--debug',
  '-f',
  '--filter',
  '-m',
  '--mode',
  '--outDir',
  '--assetsDir',
  '--assetsInlineLimit',
  '--sourcemap',
  '--minify',
])

let inputUrl = process.env.BWF_INPUT_URL ?? ''
const viteArgs = mode === 'preview' ? ['preview'] : []

for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i]
  if (arg === '--') {
    continue
  }
  if (arg.startsWith('--url=')) {
    inputUrl = arg.slice('--url='.length)
    continue
  }
  if (arg === '--url') {
    if (i + 1 < rawArgs.length) {
      inputUrl = rawArgs[i + 1]
      i += 1
    }
    continue
  }
  if (arg.startsWith('-')) {
    viteArgs.push(arg)
    const flagName = arg.split('=')[0]
    if (!arg.includes('=') && flagsWithValue.has(flagName) && i + 1 < rawArgs.length) {
      const next = rawArgs[i + 1]
      if (!next.startsWith('-')) {
        viteArgs.push(next)
        i += 1
      }
    }
    continue
  }
  if (!inputUrl) {
    inputUrl = arg
    continue
  }
  viteArgs.push(arg)
}

const child = spawn(process.execPath, [viteBin, ...viteArgs], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    BWF_INPUT_URL: inputUrl.trim(),
  },
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})
