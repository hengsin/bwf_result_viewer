const { app, BrowserWindow, net, shell } = require('electron')
const { execFile } = require('node:child_process')
const { readFile, unlink } = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const PROXY_ROUTES = [
  { prefix: '/proxy/extranet', host: 'https://extranet-lv.bwfbadminton.com', fallbackCt: 'application/json', accept: 'application/json' },
  { prefix: '/proxy/bwfworldtour', host: 'https://bwfworldtour.bwfbadminton.com', fallbackCt: 'text/html', accept: 'text/html' },
  { prefix: '/proxy/match-centre', host: 'https://match-centre.bwfbadminton.com', fallbackCt: 'text/html', accept: 'text/html' },
  { prefix: '/proxy/bwfbadminton', host: 'https://bwfbadminton.com', fallbackCt: 'text/html', accept: 'text/html' },
  { prefix: '/proxy/corporate', host: 'https://corporate.bwfbadminton.com', fallbackCt: 'text/html', accept: 'text/html' },
]

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function getInitialUrl() {
  const fromEnv = (process.env.BWF_INPUT_URL || process.env.VITE_INPUT_URL || '').trim()
  for (const arg of process.argv.slice(1)) {
    if (arg.startsWith('--url=')) {
      return arg.slice('--url='.length).trim()
    }
  }
  return fromEnv
}

async function fetchViaCurl(target, accept) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const headerFile = path.join(os.tmpdir(), `bwf-elec-h-${id}.txt`)
  const bodyFile = path.join(os.tmpdir(), `bwf-elec-b-${id}.txt`)
  const args = [
    '-s',
    '-D',
    headerFile,
    '-o',
    bodyFile,
    '-w',
    '%{http_code}',
    '-H',
    `User-Agent: ${BROWSER_UA}`,
    '-H',
    `Accept: ${accept}`,
    target,
  ]
  try {
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 50 * 1024 * 1024, timeout: 30000 })
    const status = Number.parseInt(stdout.trim(), 10)
    const [headers, body] = await Promise.all([readFile(headerFile, 'utf8'), readFile(bodyFile)])
    const contentType =
      headers
        .split('\r\n\r\n')[0]
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-type'))
        ?.split(':')
        .slice(1)
        .join(':')
        .trim() || 'application/octet-stream'
    return { status, contentType, body }
  } finally {
    await Promise.allSettled([unlink(headerFile), unlink(bodyFile)])
  }
}

async function fetchUpstream(target, accept) {
  try {
    return await fetchViaCurl(target, accept)
  } catch {
    const response = await net.fetch(target, {
      headers: { 'User-Agent': BROWSER_UA, Accept: accept },
    })
    const body = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    return { status: response.status, contentType, body }
  }
}

function createLocalServer(distDir) {
  const initialUrl = getInitialUrl()
  const distRoot = path.resolve(distDir)

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')

        if (reqUrl.pathname === '/__bwf_config.js') {
          res.statusCode = 200
          res.setHeader('content-type', 'application/javascript; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(`window.__BWF_INITIAL_URL__ = ${JSON.stringify(initialUrl)};\n`)
          return
        }

        const proxy = PROXY_ROUTES.find(
          (r) => reqUrl.pathname === r.prefix || reqUrl.pathname.startsWith(`${r.prefix}/`),
        )
        if (proxy) {
          try {
            const upstreamPath = reqUrl.pathname.slice(proxy.prefix.length) || '/'
            const target = `${proxy.host}${upstreamPath}${reqUrl.search}`
            const result = await fetchUpstream(target, proxy.accept)
            res.statusCode = result.status
            res.setHeader('content-type', result.contentType)
            res.end(result.body)
          } catch (err) {
            res.statusCode = 502
            res.setHeader('content-type', proxy.fallbackCt)
            res.end(String(err))
          }
          return
        }

        const safePath = decodeURIComponent(reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname)
        const resolved = path.resolve(distRoot, `.${safePath}`)
        if (resolved !== distRoot && !resolved.startsWith(`${distRoot}${path.sep}`)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }

        let filePath = resolved
        let data
        try {
          data = await readFile(filePath)
        } catch {
          filePath = path.join(distRoot, 'index.html')
          data = await readFile(filePath)
        }

        const ext = path.extname(filePath).toLowerCase()
        res.statusCode = 200
        res.setHeader('content-type', MIME_TYPES[ext] || 'application/octet-stream')
        res.end(data)
      } catch (err) {
        res.statusCode = 500
        res.end(String(err))
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: `http://127.0.0.1:${address.port}/` })
    })
  })
}

let localServer = null

async function createWindow() {
  const distDir = path.join(__dirname, '..', 'dist')
  const started = await createLocalServer(distDir)
  localServer = started.server

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 420,
    minHeight: 600,
    title: 'BWF Match Schedule',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icons', 'icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(started.url)) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url)
      }
    }
  })

  await win.loadURL(started.url)
}

app.whenReady().then(() => {
  void createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (localServer) {
    localServer.close()
    localServer = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
