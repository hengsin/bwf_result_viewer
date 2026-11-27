import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }
const APP_VERSION = pkg.version ?? '1.0.1'

// Proxy the BWF backend hosts so the browser can fetch them without CORS issues.
// /proxy/<name>/... -> https://<host>/...
const browserHeaders: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

// Cloudflare's bot management challenges some automated clients (e.g. undici's fetch),
// but lets plain curl through, so the proxy uses curl when available.
const fetchViaCurl = async (target: string, accept: string): Promise<{ status: number; contentType: string; body: string }> => {
  const headerFile = join(tmpdir(), `bwf-proxy-h-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const bodyFile = join(tmpdir(), `bwf-proxy-b-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const args = [
    '-s',
    '-D',
    headerFile,
    '-o',
    bodyFile,
    '-w',
    '%{http_code}',
    '-H',
    `User-Agent: ${browserHeaders['User-Agent']}`,
    '-H',
    `Accept: ${accept}`,
    target,
  ]
  const status = Number.parseInt(execFileSync('curl', args, { maxBuffer: 50 * 1024 * 1024, timeout: 30000 }).toString().trim(), 10)
  const headers = await readFile(headerFile, 'utf8')
  const body = await readFile(bodyFile, 'utf8')
  await Promise.all([unlink(headerFile), unlink(bodyFile)])
  const contentType =
    headers
      .split('\r\n\r\n')[0]
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-type'))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim() ?? 'application/octet-stream'
  return { status, contentType, body }
}

const attachBwfMiddlewares = (middlewares: Connect.Server) => {
  const initialUrl = (process.env.BWF_INPUT_URL ?? process.env.VITE_INPUT_URL ?? '').trim()

  middlewares.use('/bwf-config.js', (_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/javascript; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(`window.__BWF_INITIAL_URL__ = ${JSON.stringify(initialUrl)};\n`)
  })

  const proxyTo = (prefix: string, host: string, fallbackContentType: string, accept: string) => {
    middlewares.use(prefix, (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const target = `${host}${url.pathname}${url.search}`
          const response = await fetchViaCurl(target, accept)
          res.statusCode = response.status
          res.setHeader('content-type', response.contentType)
          res.end(response.body)
        } catch (e) {
          res.statusCode = 502
          res.setHeader('content-type', fallbackContentType)
          res.end(String(e))
        }
      })()
    })
  }

  proxyTo('/proxy/extranet', 'https://extranet-lv.bwfbadminton.com', 'application/json', 'application/json')
  proxyTo('/proxy/bwfworldtour', 'https://bwfworldtour.bwfbadminton.com', 'text/html', 'text/html')
  proxyTo('/proxy/match-centre', 'https://match-centre.bwfbadminton.com', 'text/html', 'text/html')
  proxyTo('/proxy/bwfbadminton', 'https://bwfbadminton.com', 'text/html', 'text/html')
  proxyTo('/proxy/corporate', 'https://corporate.bwfbadminton.com', 'text/html', 'text/html')
}

const bwfProxyPlugin = (): Plugin => ({
  name: 'bwf-proxy',
  configureServer(server) {
    attachBwfMiddlewares(server.middlewares)
  },
  configurePreviewServer(server) {
    attachBwfMiddlewares(server.middlewares)
  },
})

export default defineConfig(({ mode }) => {
  const define = {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  }
  if (mode === 'extension') {
    return {
      base: './',
      define,
      plugins: [react()],
      build: {
        outDir: 'dist-extension',
        emptyOutDir: true,
      },
    }
  }
  return {
    define,
    plugins: [react(), bwfProxyPlugin()],
  }
})
