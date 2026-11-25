import { EXTRANET_BASE } from './bwf'
import type { BwfPlayer } from './bwf'
import { toSafeHttpsUrl } from './schedule'

export interface PlayerRankingEventOption {
  id: string
  name: string
  partner_id: number
}

export interface PlayerProfileData {
  playerId: string
  eventLabel: string | null
  currentRank: number | null
  highestRank: number | null
  highestRankDate: string | null
  age: number | null
  hand: 'Right' | 'Left' | null
  heightCm: number | null
  residence: string | null
  placeOfBirth: string | null
  prizeMoney: string | null
}

const EVENT_PREFIX_BY_CODE: Record<string, string> = {
  MS: '6',
  WS: '7',
  MD: '8',
  WD: '9',
  XD: '10',
}

const SAFE_PLAYER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/
const SAFE_SLUG_PATTERN = /^[a-zA-Z0-9-]{1,120}$/

const profileCache = new Map<string, PlayerProfileData>()
const inFlightRequests = new Map<string, Promise<PlayerProfileData>>()

/**
 * Builds a validated HTTPS URL to a player's official BWF profile page.
 */
export function getPlayerProfileUrl(player: BwfPlayer): string | null {
  const id = player.id?.trim() ?? ''
  if (!SAFE_PLAYER_ID_PATTERN.test(id)) {
    return null
  }
  const slug = player.slug?.trim() ?? ''
  const rawUrl = SAFE_SLUG_PATTERN.test(slug)
    ? `https://bwfbadminton.com/player/${encodeURIComponent(id)}/${encodeURIComponent(slug)}/`
    : `https://bwfbadminton.com/player/${encodeURIComponent(id)}/`
  return toSafeHttpsUrl(rawUrl)
}

function getCacheKey(playerId: string, eventName?: string, partnerId?: string | null): string {
  const normalizedEvent = (eventName ?? '').trim().toUpperCase()
  const normalizedPartner = (partnerId ?? '').trim()
  return `${playerId}|${normalizedEvent}|${normalizedPartner}`
}

export function getCachedPlayerProfile(
  playerId: string,
  eventName?: string,
  partnerId?: string | null,
): PlayerProfileData | null {
  return profileCache.get(getCacheKey(playerId, eventName, partnerId)) ?? null
}

function normalizeText(value: unknown, maxLength = 80): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  return trimmed.slice(0, maxLength)
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed)
    }
  }
  return null
}

function formatHand(raw: unknown): 'Right' | 'Left' | null {
  if (typeof raw !== 'string') {
    return null
  }
  const code = raw.trim().toUpperCase()
  if (code === 'R') {
    return 'Right'
  }
  if (code === 'L') {
    return 'Left'
  }
  return null
}

function formatPlace(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  // BWF bio strings are often uppercase like "THAILAND" or lowercase like "rayong thailand".
  if (raw === raw.toUpperCase() || raw === raw.toLowerCase()) {
    return raw
      .toLowerCase()
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
  }
  return raw
}

function pickBestRankingEvent(
  events: PlayerRankingEventOption[],
  eventName?: string,
  partnerId?: string | null,
): PlayerRankingEventOption | null {
  if (events.length === 0) {
    return null
  }
  const normalizedEvent = (eventName ?? '').trim().toUpperCase()
  const prefix = EVENT_PREFIX_BY_CODE[normalizedEvent]
  const partner = partnerId?.trim() ?? ''

  if (prefix && partner) {
    const exactPair = events.find(
      (ev) => ev.id.startsWith(`${prefix}-`) && String(ev.partner_id) === partner,
    )
    if (exactPair) {
      return exactPair
    }
  }
  if (prefix) {
    const disciplineMatch = events.find((ev) => ev.id.startsWith(`${prefix}-`))
    if (disciplineMatch) {
      return disciplineMatch
    }
  }
  return events[0]
}

async function fetchJsonSafely<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return null
    }
    return (await res.json()) as T
  } catch {
    return null
  }
}

interface BioApiResponse {
  height?: string | number | null
  age?: number | string | null
  hand?: string | null
  current_residence?: string | null
  prize_money?: string | null
  qa?: {
    place_of_birth?: string | null
  } | null
}

interface RankingEventsApiResponse {
  results?: Record<string, PlayerRankingEventOption> | null
}

interface RankingCurrentApiResponse {
  results?: number | string | null
}

interface RankingHighestApiResponse {
  results?: {
    rank?: number | string | null
    date?: string | null
  } | null
}

/**
 * Fetches and caches public player bio and ranking summary from the BWF extranet API.
 */
export async function fetchPlayerProfile(
  player: BwfPlayer,
  eventName?: string,
  partnerId?: string | null,
): Promise<PlayerProfileData> {
  const playerId = player.id?.trim() ?? ''
  if (!SAFE_PLAYER_ID_PATTERN.test(playerId)) {
    return {
      playerId,
      eventLabel: null,
      currentRank: null,
      highestRank: null,
      highestRankDate: null,
      age: null,
      hand: null,
      heightCm: null,
      residence: null,
      placeOfBirth: null,
      prizeMoney: null,
    }
  }

  const key = getCacheKey(playerId, eventName, partnerId)
  const cached = profileCache.get(key)
  if (cached) {
    return cached
  }
  const existingPromise = inFlightRequests.get(key)
  if (existingPromise) {
    return existingPromise
  }

  const loadPromise = (async (): Promise<PlayerProfileData> => {
    const encodedId = encodeURIComponent(playerId)
    const [bio, rankingEventsRes] = await Promise.all([
      fetchJsonSafely<BioApiResponse>(`${EXTRANET_BASE}/api/vue-player-bio?playerId=${encodedId}`),
      fetchJsonSafely<RankingEventsApiResponse>(
        `${EXTRANET_BASE}/api/vue-player-ranking-events?playerId=${encodedId}`,
      ),
    ])

    const eventOptions = rankingEventsRes?.results ? Object.values(rankingEventsRes.results) : []
    const chosenEvent = pickBestRankingEvent(eventOptions, eventName, partnerId)

    let currentRank: number | null = null
    let highestRank: number | null = null
    let highestRankDate: string | null = null

    if (chosenEvent?.id) {
      const encodedEvent = encodeURIComponent(chosenEvent.id)
      const [currentRes, highestRes] = await Promise.all([
        fetchJsonSafely<RankingCurrentApiResponse>(
          `${EXTRANET_BASE}/api/vue-player-ranking-current?playerId=${encodedId}&rankingEvent=${encodedEvent}`,
        ),
        fetchJsonSafely<RankingHighestApiResponse>(
          `${EXTRANET_BASE}/api/vue-player-ranking-highest?playerId=${encodedId}&rankingEvent=${encodedEvent}`,
        ),
      ])
      currentRank = parsePositiveInt(currentRes?.results)
      highestRank = parsePositiveInt(highestRes?.results?.rank)
      highestRankDate = normalizeText(highestRes?.results?.date, 20)
    }

    const rawPrize = normalizeText(bio?.prize_money, 30)
    const prizeMoney = rawPrize && rawPrize !== '0' ? rawPrize : null

    const profile: PlayerProfileData = {
      playerId,
      eventLabel: normalizeText(chosenEvent?.name, 80),
      currentRank,
      highestRank,
      highestRankDate,
      age: parsePositiveInt(bio?.age),
      hand: formatHand(bio?.hand),
      heightCm: parsePositiveInt(bio?.height),
      residence: formatPlace(normalizeText(bio?.current_residence, 60)),
      placeOfBirth: formatPlace(normalizeText(bio?.qa?.place_of_birth, 60)),
      prizeMoney,
    }

    profileCache.set(key, profile)
    return profile
  })()

  inFlightRequests.set(key, loadPromise)
  try {
    return await loadPromise
  } finally {
    inFlightRequests.delete(key)
  }
}
