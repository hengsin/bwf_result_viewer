const GITHUB_REPO = 'hengsin/bwf_result_viewer'
const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

/**
 * Parse a SemVer string (with optional leading `v` and `+build` metadata).
 * Returns null if the string is not a valid `major.minor.patch[-prerelease]` version.
 */
function parseSemver(raw) {
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim().replace(/^[vV]/, '').split('+')[0]
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed)
  if (!match) {
    return null
  }
  return {
    normalized: match[4] ? `${match[1]}.${match[2]}.${match[3]}-${match[4]}` : `${match[1]}.${match[2]}.${match[3]}`,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/**
 * Compare two parsed SemVer objects (`1` if a > b, `-1` if a < b, `0` if equal).
 */
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i += 1) {
    const segA = a.prerelease[i]
    const segB = b.prerelease[i]
    if (segA === undefined) return -1
    if (segB === undefined) return 1
    if (segA === segB) continue

    const numA = /^\d+$/.test(segA) ? Number.parseInt(segA, 10) : null
    const numB = /^\d+$/.test(segB) ? Number.parseInt(segB, 10) : null
    if (numA !== null && numB !== null) {
      return numA > numB ? 1 : -1
    }
    if (numA !== null) return -1
    if (numB !== null) return 1
    return segA > segB ? 1 : -1
  }
  return 0
}

/**
 * Validate that a release URL points to the official GitHub repository over HTTPS.
 */
function sanitizeReleaseUrl(rawUrl, repo = GITHUB_REPO) {
  const fallback = `https://github.com/${repo}/releases`
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return fallback
  }
  try {
    const parsed = new URL(rawUrl.trim())
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith(`/${repo}/`)
    ) {
      return parsed.toString()
    }
  } catch {
    // Fall back to canonical releases page on invalid URL.
  }
  return fallback
}

/**
 * Create a lightweight cached GitHub Releases update checker.
 */
function createUpdateChecker({
  currentVersion,
  fetchImpl,
  repo = GITHUB_REPO,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
}) {
  const parsedCurrent = parseSemver(currentVersion)
  const normalizedCurrent = parsedCurrent ? parsedCurrent.normalized : String(currentVersion || '0.0.0')
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`
  const releasesPage = `https://github.com/${repo}/releases`

  let cached = null
  let inFlight = null

  async function performCheck() {
    const checkedAt = Date.now()
    if (!parsedCurrent) {
      return {
        status: 'error',
        currentVersion: normalizedCurrent,
        latestVersion: null,
        releaseUrl: null,
        releaseName: null,
        publishedAt: null,
        checkedAt,
        error: 'Invalid current application version',
      }
    }

    try {
      const response = await fetchImpl(apiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `BWF-Match-Schedule/${normalizedCurrent}`,
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })

      if (response.status === 404) {
        return {
          status: 'up-to-date',
          currentVersion: normalizedCurrent,
          latestVersion: normalizedCurrent,
          releaseUrl: releasesPage,
          releaseName: null,
          publishedAt: null,
          checkedAt,
          error: null,
        }
      }

      if (!response.ok) {
        return {
          status: 'error',
          currentVersion: normalizedCurrent,
          latestVersion: null,
          releaseUrl: null,
          releaseName: null,
          publishedAt: null,
          checkedAt,
          error: `Update check failed (HTTP ${response.status})`,
        }
      }

      const data = await response.json()
      if (!data || typeof data !== 'object' || data.draft === true || data.prerelease === true) {
        return {
          status: 'up-to-date',
          currentVersion: normalizedCurrent,
          latestVersion: normalizedCurrent,
          releaseUrl: releasesPage,
          releaseName: null,
          publishedAt: null,
          checkedAt,
          error: null,
        }
      }

      const rawTag = typeof data.tag_name === 'string' && data.tag_name.trim()
        ? data.tag_name
        : typeof data.name === 'string'
          ? data.name
          : ''
      const parsedLatest = parseSemver(rawTag)
      if (!parsedLatest) {
        return {
          status: 'error',
          currentVersion: normalizedCurrent,
          latestVersion: null,
          releaseUrl: null,
          releaseName: null,
          publishedAt: null,
          checkedAt,
          error: 'Invalid release version format',
        }
      }

      const isNewer = compareSemver(parsedLatest, parsedCurrent) > 0
      return {
        status: isNewer ? 'update-available' : 'up-to-date',
        currentVersion: normalizedCurrent,
        latestVersion: parsedLatest.normalized,
        releaseUrl: sanitizeReleaseUrl(data.html_url, repo),
        releaseName: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
        publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
        checkedAt,
        error: null,
      }
    } catch {
      return {
        status: 'error',
        currentVersion: normalizedCurrent,
        latestVersion: null,
        releaseUrl: null,
        releaseName: null,
        publishedAt: null,
        checkedAt,
        error: 'Unable to reach GitHub Releases',
      }
    }
  }

  return {
    async checkForUpdates({ force = false } = {}) {
      if (!force && cached && cached.status !== 'error' && Date.now() - cached.checkedAt < cacheTtlMs) {
        return cached
      }
      if (!force && inFlight) {
        return inFlight
      }

      const promise = performCheck().then((result) => {
        if (result.status !== 'error' || !cached) {
          cached = result
        }
        return result
      })
      inFlight = promise
      try {
        return await promise
      } finally {
        if (inFlight === promise) {
          inFlight = null
        }
      }
    },
  }
}

module.exports = {
  GITHUB_REPO,
  RELEASES_PAGE_URL,
  LATEST_RELEASE_API,
  parseSemver,
  compareSemver,
  sanitizeReleaseUrl,
  createUpdateChecker,
}
