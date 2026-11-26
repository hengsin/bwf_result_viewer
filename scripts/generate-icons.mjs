import puppeteer from 'puppeteer-core'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

const targets = [
  { out: resolve(rootDir, 'extension/icons/icon-16.png'), size: 16 },
  { out: resolve(rootDir, 'extension/icons/icon-48.png'), size: 48 },
  { out: resolve(rootDir, 'extension/icons/icon-128.png'), size: 128 },
  { out: resolve(rootDir, 'electron/icons/icon-256.png'), size: 256 },
  { out: resolve(rootDir, 'electron/icons/icon-512.png'), size: 512 },
]

const svg = await readFile(resolve(rootDir, 'public/favicon.svg'), 'utf8')
const browser = await puppeteer.launch({
  executablePath: '/usr/sbin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  for (const { out, size } of targets) {
    await mkdir(dirname(out), { recursive: true })
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden;">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    )
    await page.screenshot({ path: out, omitBackground: true })
  }
  console.log(`Generated ${targets.length} PNG icons.`)
} finally {
  await browser.close()
}
