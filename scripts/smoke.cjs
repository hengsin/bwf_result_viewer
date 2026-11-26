/* Headless smoke test for the BWF Match Schedule app. */
const puppeteer = require('puppeteer-core')

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/sbin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message))

  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((resolve) => setTimeout(resolve, 12000))

  const initial = await page.evaluate(() => ({
    hasSchedule: !!document.querySelector('.schedule'),
    matchRowCount: document.querySelectorAll('.match-row').length,
    firstTime: document.querySelector('.match-time-value')?.textContent ?? null,
    firstSchedule: document.querySelector('.match-schedule')?.textContent ?? null,
    status: document.querySelector('.match-status')?.textContent ?? null,
    sourceTzNote: document.querySelector('.schedule-timezone-note')?.textContent ?? null,
  }))
  console.log('INITIAL', JSON.stringify(initial))

  const onlyInProgressToggle = await page.$('#bwf-only-in-progress')
  console.log('ONLY IN PROGRESS TOGGLE FOUND:', !!onlyInProgressToggle)
  if (onlyInProgressToggle) {
    await onlyInProgressToggle.click()
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const afterToggle = await page.evaluate(() => ({
    matchRowCount: document.querySelectorAll('.match-row').length,
    statuses: Array.from(document.querySelectorAll('.match-status')).map((el) => el.textContent),
  }))
  console.log('AFTER TOGGLE', JSON.stringify(afterToggle))

  const autoRefreshToggle = await page.$('.auto-refresh-toggle input')
  if (autoRefreshToggle) {
    await autoRefreshToggle.click()
  }
  const countdown = await page.$eval('.countdown', (el) => el.textContent).catch(() => null)
  console.log('COUNTDOWN', countdown)
  const intervalSelect = await page.$('.interval-select')
  console.log('INTERVAL SELECT VALUE:', intervalSelect ? await intervalSelect.evaluate((el) => el.value) : null)

  const refreshButtons = await page.$$eval('button', (buttons) => buttons.map((b) => b.textContent?.trim()).filter(Boolean))
  console.log('BUTTONS', JSON.stringify(refreshButtons))

  await page.screenshot({ path: '/tmp/opencode/bwf-app.png', fullPage: false })
  await browser.close()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
