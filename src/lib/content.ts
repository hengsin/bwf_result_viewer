import { toProxyUrl } from './bwf'
import { convertTimeText, getBrowserTimeZone } from './time'

const contextDateFromUrl = (url: string): string => {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    const match = /(\d{4}-\d{2}-\d{2})\/?$/.exec(parsed.pathname)
    if (match) {
      return match[1]
    }
  } catch {
    // fall through to today
  }
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export async function fetchRawPageHtml(
  url: string,
): Promise<{ rawHtml: string; contextDate: string; pageTitle: string | null }> {
  const { proxyPath, directUrl } = toProxyUrl(url)
  const target = proxyPath ?? directUrl
  const response = await fetch(target, {
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${response.status})`)
  }
  const rawHtml = await response.text()
  const parsedTitle = new DOMParser().parseFromString(rawHtml, 'text/html').title.trim()
  return { rawHtml, contextDate: contextDateFromUrl(url), pageTitle: parsedTitle || null }
}

export function convertHtmlTimeText(rawHtml: string, sourceTimeZone: string, contextDate: string): string {
  const parsedDocument = new DOMParser().parseFromString(rawHtml, 'text/html')
  const root = parsedDocument.body ?? parsedDocument.documentElement
  convertDocumentTimeText(root, sourceTimeZone, contextDate)
  return root.innerHTML
}

export async function fetchAndConvertPageHtml(
  url: string,
  sourceTimeZone: string,
): Promise<{ html: string; contextDate: string }> {
  const { rawHtml, contextDate } = await fetchRawPageHtml(url)
  return { html: convertHtmlTimeText(rawHtml, sourceTimeZone, contextDate), contextDate }
}

export function convertDocumentTimeText(root: Node, sourceTimeZone: string, contextDate: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes: Text[] = []
  let node: Node | null = walker.nextNode()
  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }
  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? ''
    const converted = convertTimeText(value, sourceTimeZone, contextDate)
    if (converted !== value) {
      textNode.nodeValue = converted
    }
  }
}

export function browserTimeZoneLabel(): string {
  const timeZone = getBrowserTimeZone()
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
  const parts = formatter.formatToParts(new Date())
  const timeZoneName = parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone
  return `${timeZone} (${timeZoneName})`
}
