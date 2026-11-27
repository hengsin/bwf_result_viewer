const DISMISSED_UPDATE_KEY = 'bwf-dismissed-update-version'
const GITHUB_REPO_PREFIX = '/hengsin/bwf_result_viewer/'
const FALLBACK_RELEASES_URL = 'https://github.com/hengsin/bwf_result_viewer/releases'

export type UpdateStatus = 'update-available' | 'up-to-date' | 'error'

export interface UpdateCheckResult {
  status: UpdateStatus
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  releaseName: string | null
  publishedAt: string | null
  checkedAt: number
  error: string | null
}

declare global {
  const __APP_VERSION__: string | undefined
  interface Window {
    __BWF_DESKTOP__?: boolean
    __BWF_APP_VERSION__?: string
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.__BWF_DESKTOP__ === true
}

export function getAppVersion(): string {
  if (typeof window !== 'undefined' && typeof window.__BWF_APP_VERSION__ === 'string' && window.__BWF_APP_VERSION__) {
    return window.__BWF_APP_VERSION__
  }
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '1.0.1'
}

/**
 * Validate release URL on the client so external links only point to the official repository over HTTPS.
 */
export function getSafeReleaseUrl(rawUrl: string | null | undefined): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return FALLBACK_RELEASES_URL
  }
  try {
    const parsed = new URL(rawUrl.trim())
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith(GITHUB_REPO_PREFIX)
    ) {
      return parsed.toString()
    }
  } catch {
    // Fall back to canonical releases page on invalid URL.
  }
  return FALLBACK_RELEASES_URL
}

export function loadDismissedUpdateVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_KEY)
  } catch {
    return null
  }
}

export function saveDismissedUpdateVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_UPDATE_KEY, version)
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

export async function checkForAppUpdates(force = false, signal?: AbortSignal): Promise<UpdateCheckResult> {
  const endpoint = force ? '/__bwf_update_check?force=1' : '/__bwf_update_check'
  const response = await fetch(endpoint, {
    cache: 'no-store',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Update check failed (HTTP ${response.status})`)
  }
  const data = (await response.json()) as Partial<UpdateCheckResult>
  return {
    status: data.status === 'update-available' || data.status === 'up-to-date' ? data.status : 'error',
    currentVersion: typeof data.currentVersion === 'string' ? data.currentVersion : getAppVersion(),
    latestVersion: typeof data.latestVersion === 'string' ? data.latestVersion : null,
    releaseUrl: data.releaseUrl ? getSafeReleaseUrl(data.releaseUrl) : null,
    releaseName: typeof data.releaseName === 'string' ? data.releaseName : null,
    publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : null,
    checkedAt: typeof data.checkedAt === 'number' ? data.checkedAt : Date.now(),
    error: typeof data.error === 'string' ? data.error : null,
  }
}
