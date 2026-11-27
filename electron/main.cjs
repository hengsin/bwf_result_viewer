const { app, BrowserWindow, Menu, ipcMain, net, shell } = require('electron')
const { execFile } = require('node:child_process')
const { readFile, unlink } = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const pkg = require('../package.json')
const { createUpdateChecker } = require('./updater.cjs')

const execFileAsync = promisify(execFile)
const APP_VERSION = (pkg && typeof pkg.version === 'string' && pkg.version) || app.getVersion()
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
const MIN_ZOOM_FACTOR = ZOOM_STEPS[0]
const MAX_ZOOM_FACTOR = ZOOM_STEPS[ZOOM_STEPS.length - 1]
const updateChecker = createUpdateChecker({
  currentVersion: APP_VERSION,
  fetchImpl: (url, init) => net.fetch(url, init),
})

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
          res.setHeader('x-content-type-options', 'nosniff')
          res.end(
            `window.__BWF_INITIAL_URL__ = ${JSON.stringify(initialUrl)};\n` +
              `window.__BWF_DESKTOP__ = true;\n` +
              `window.__BWF_APP_VERSION__ = ${JSON.stringify(APP_VERSION)};\n`,
          )
          return
        }

        if (reqUrl.pathname === '/__bwf_update_check') {
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('x-content-type-options', 'nosniff')
            res.end(JSON.stringify({ error: 'Method Not Allowed' }))
            return
          }
          const force = reqUrl.searchParams.get('force') === '1'
          const result = await updateChecker.checkForUpdates({ force })
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.setHeader('x-content-type-options', 'nosniff')
          res.end(JSON.stringify(result))
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

function clampZoomFactor(factor) {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) {
    return 1
  }
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, Math.round(factor * 100) / 100))
}

function stepZoomFactor(currentFactor, action) {
  if (action === 'reset') {
    return 1
  }
  if (action === 'in') {
    const next = ZOOM_STEPS.find((step) => step > currentFactor + 0.001)
    return next ?? MAX_ZOOM_FACTOR
  }
  if (action === 'out') {
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
      if (ZOOM_STEPS[i] < currentFactor - 0.001) {
        return ZOOM_STEPS[i]
      }
    }
    return MIN_ZOOM_FACTOR
  }
  return clampZoomFactor(currentFactor)
}

function applyZoomFactor(webContents, factor) {
  const next = clampZoomFactor(factor)
  webContents.setZoomFactor(next)
  webContents.send('bwf:zoom-changed', next)
  return next
}

function adjustWindowZoom(win, action) {
  if (!win || win.isDestroyed()) {
    return 1
  }
  const current = win.webContents.getZoomFactor()
  const next = stepZoomFactor(current, action)
  return applyZoomFactor(win.webContents, next)
}

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: (_item, focusedWindow) => {
            adjustWindowZoom(focusedWindow, 'reset')
          },
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: (_item, focusedWindow) => {
            adjustWindowZoom(focusedWindow, 'in')
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: (_item, focusedWindow) => {
            adjustWindowZoom(focusedWindow, 'out')
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}

function getZoomActionFromInput(input) {
  if (input.type !== 'keyDown' || input.alt) {
    return null
  }
  const primaryPressed = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!primaryPressed) {
    return null
  }
  if (input.key === '+' || input.key === '=' || input.code === 'Equal' || input.code === 'NumpadAdd') {
    return 'in'
  }
  if (
    input.key === '-' ||
    input.key === '_' ||
    (input.code === 'Minus' && !input.shift) ||
    input.code === 'NumpadSubtract'
  ) {
    return 'out'
  }
  if ((input.key === '0' && !input.shift) || input.code === 'Numpad0') {
    return 'reset'
  }
  return null
}

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
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.webContents.on('did-finish-load', () => {
    void win.webContents.setVisualZoomLevelLimits(1, 5)
  })

  win.webContents.on('before-input-event', (event, input) => {
    const action = getZoomActionFromInput(input)
    if (!action) {
      return
    }
    event.preventDefault()
    adjustWindowZoom(win, action)
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
  Menu.setApplicationMenu(buildApplicationMenu())

  ipcMain.handle('bwf:get-zoom', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? clampZoomFactor(win.webContents.getZoomFactor()) : 1
  })

  ipcMain.handle('bwf:zoom', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !['in', 'out', 'reset'].includes(action)) {
      return 1
    }
    return adjustWindowZoom(win, action)
  })

  ipcMain.handle('bwf:set-zoom', (event, factor) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return 1
    }
    return applyZoomFactor(win.webContents, factor)
  })

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
