const EXTENSION_ENTRY = 'index.html'
const TRAILING_DATE_PATTERN = /\/\d{4}-\d{2}-\d{2}\/?$/
const TOURNAMENT_PATH_PATTERN = /^\/tournament\/[^/]+/

function isBwfScheduleTabUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return false
  }
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false
    }
    const isBwfHost =
      parsed.hostname === 'bwfbadminton.com' || parsed.hostname.endsWith('.bwfbadminton.com')
    if (!isBwfHost) {
      return false
    }
    return TOURNAMENT_PATH_PATTERN.test(parsed.pathname) || TRAILING_DATE_PATTERN.test(parsed.pathname)
  } catch {
    return false
  }
}

async function openExtensionTab(activeTab) {
  const baseUrl = chrome.runtime.getURL(EXTENSION_ENTRY)
  if (activeTab?.url?.startsWith(baseUrl)) {
    return
  }

  const hasBwfUrl = Boolean(activeTab?.url && isBwfScheduleTabUrl(activeTab.url))
  const targetUrl = hasBwfUrl
    ? `${baseUrl}?url=${encodeURIComponent(activeTab.url)}`
    : baseUrl

  const [existing] = await chrome.tabs.query({ url: `${baseUrl}*` })
  if (existing?.id !== undefined) {
    const updateProps = hasBwfUrl ? { url: targetUrl, active: true } : { active: true }
    await chrome.tabs.update(existing.id, updateProps)
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
    return
  }

  await chrome.tabs.create({ url: targetUrl })
}

chrome.action.onClicked.addListener((tab) => {
  void openExtensionTab(tab)
})
