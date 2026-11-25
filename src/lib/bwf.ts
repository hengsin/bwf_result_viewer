import { getTimeZoneOffsetMs, isValidIsoDate } from './time'

export interface BwfTournament {
  id: number
  code: string
  name: string
  start_date: string
  end_date: string
  slug: string
  prize_money: string
  venue_name: string
  venue_address1: string
  date: string
  tmtLink?: string | null
  categoryModel?: { id: number; name: string } | null
}

export interface BwfPlayer {
  id: string
  nameDisplay: string
  nameType: number
  firstName: string
  lastName: string
  initials: string
  nameShort: string
  nameShort2: string
  slug: string
  countryCode: string | null
  countryName: string | null
  countryFlagUrl: string | null
  avatar: { title: string; thumbnailUrl: string } | null
}

export interface BwfTeam {
  countryCode: string | null
  countryFlagUrl: string | null
  teamId: number | null
  teamName: string | null
  players: BwfPlayer[]
  linkName: string | null
}

export interface DayMatch {
  id: number
  code: string
  tournamentCode: string
  tournamentName: string
  isTeamMatch: boolean
  scoreStatus: number
  scoreStatusValue: string
  winner: number
  team1: BwfTeam
  team2: BwfTeam
  team1seed: string | null
  team2seed: string | null
  matchTime: string
  matchTimeUtc: string
  matchStatus: string
  matchStatusValue: string
  oopRound: string
  oopText: string
  oopTypeId: number
  eventName: string
  roundName: string
  drawName: string
  drawCode: string
  courtName: string
  courtCode: string
  courtIndex: number
  locationName: string
  duration: number | null
  time: string
  matchOrder: number | null
  matchTypeId: number
  matchTypeValue: string
  matchTypeNo: string | null
  reliability: number
  score: unknown[]
  matches: DayMatch[]
}

export interface BwfTournamentDetails {
  tmtId: string
  tournament: BwfTournament
}

export const EXTRANET_BASE = '/proxy/extranet'
export const CORPORATE_BASE = '/proxy/corporate'

export interface CalendarTournament {
  id: string
  name: string
  dates: string
  countryCode: string
  category: string
  city: string
  week: string
}

/** Fetches tournament metadata from BWF Extranet by numeric tournament ID. */
export async function fetchBwfTournamentById(tmtId: string): Promise<BwfTournament> {
  const res = await fetch(`${EXTRANET_BASE}/api/match-center/vue-tournament-detail?tmtId=${encodeURIComponent(tmtId)}`)
  if (!res.ok) {
    throw new Error(`BWF tournament detail request failed with status ${res.status}`)
  }
  const data = (await res.json()) as { results?: BwfTournament }
  const tournament = data?.results
  if (!tournament) {
    throw new Error('BWF tournament detail response did not contain a tournament')
  }
  return tournament
}

export async function fetchBwfTournamentDetails(url: string): Promise<BwfTournamentDetails | null> {
  const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`
  const parsed = new URL(withProtocol)
  const match = /^\/tournament\/([^/]+)\/([^/]+)(\/.*)?$/.exec(parsed.pathname)
  if (!match) {
    return null
  }
  const tmtId = match[1]
  const tournament = await fetchBwfTournamentById(tmtId)
  return { tmtId, tournament }
}

function normalizeCellText(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Extracts tournaments for the given uppercase month heading (e.g. `NOVEMBER`) from the BWF calendar HTML. */
export function parseCurrentMonthTournaments(html: string, monthNameUpper: string): CalendarTournament[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const sections = Array.from(doc.querySelectorAll('.item-results'))
  const targetSection = sections.find((section) => {
    const heading = normalizeCellText(section.querySelector('h2')).toUpperCase()
    return heading === monthNameUpper.toUpperCase()
  })
  if (!targetSection) {
    return []
  }

  const tournaments: CalendarTournament[] = []
  const seenIds = new Set<string>()
  const rows = Array.from(targetSection.querySelectorAll('tr'))
  for (const row of rows) {
    const expander = row.querySelector<HTMLAnchorElement>('a.bwf-calendar_expander[data-target]')
    if (!expander) {
      continue
    }
    const rawTarget = expander.getAttribute('data-target') ?? ''
    const id = rawTarget.replace(/^#/, '').trim()
    const name = normalizeCellText(expander)
    if (!id || !name || seenIds.has(id)) {
      continue
    }
    seenIds.add(id)

    const cells = Array.from(row.querySelectorAll('td'))
    const week = normalizeCellText(cells[0])
    const countryCode = normalizeCellText(row.querySelector('.country_code') ?? cells[1])
    const rawDates = normalizeCellText(cells[2])
    const dates = rawDates.replace(/\s*-\s*/g, '–')
    const category = normalizeCellText(cells[5]?.querySelector('.name') ?? cells[5])
    const city = normalizeCellText(cells[6])

    tournaments.push({
      id,
      name,
      dates,
      countryCode,
      category,
      city,
      week,
    })
  }
  return tournaments
}

/** Fetches the BWF corporate calendar page for `year` and returns tournaments for `monthNameUpper`. */
export async function fetchCurrentMonthTournaments(
  year: number,
  monthNameUpper: string,
): Promise<CalendarTournament[]> {
  const res = await fetch(`${CORPORATE_BASE}/events/calendar/${year}/remaining/0/-1/`, {
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  })
  if (!res.ok) {
    throw new Error(`BWF calendar request failed with status ${res.status}`)
  }
  const html = await res.text()
  return parseCurrentMonthTournaments(html, monthNameUpper)
}

/**
 * Builds a `bwfbadminton.com/tournament` results URL ending with `dateIso` (`YYYY-MM-DD`).
 * When the base link ends with `overview`, replaces `overview` with `results/<dateIso>`.
 */
export function buildTournamentResultsUrl(
  tmtLink: string | null | undefined,
  tmtId: string,
  slug: string | undefined,
  dateIso: string,
): string {
  const fallbackUrl = `https://bwfbadminton.com/tournament/${tmtId}/${slug || 'tournament'}`
  const candidate = tmtLink?.trim() || ''
  const rawBase = candidate.includes('bwfbadminton.com/tournament') ? candidate : fallbackUrl
  const withProtocol = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`
  const parsed = new URL(withProtocol)
  let pathname = parsed.pathname.replace(/\/+$/, '')

  if (/\/overview$/i.test(pathname)) {
    pathname = pathname.replace(/\/overview$/i, `/results/${dateIso}`)
  } else if (/\/results\/\d{4}-\d{2}-\d{2}$/i.test(pathname)) {
    pathname = pathname.replace(/\d{4}-\d{2}-\d{2}$/, dateIso)
  } else if (/\/results$/i.test(pathname)) {
    pathname = `${pathname}/${dateIso}`
  } else {
    pathname = `${pathname}/results/${dateIso}`
  }

  return `${parsed.origin}${pathname}`
}

/** Extracts the numeric tournament ID from a `bwfbadminton.com/tournament/<id>/...` URL, if present. */
export function extractTournamentIdFromUrl(rawUrl: string): string | null {
  const parsed = parseHttpUrl(rawUrl)
  if (!parsed) {
    return null
  }
  const match = /^\/tournament\/([^/]+)/.exec(parsed.pathname)
  return match ? match[1] : null
}

export async function fetchDayMatches(tournamentCode: string, date: string): Promise<DayMatch[]> {
  const params = new URLSearchParams({
    tournamentCode,
    date,
    order: '2',
    court: '0',
  })
  const res = await fetch(`${EXTRANET_BASE}/api/tournaments/day-matches?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`BWF day matches request failed with status ${res.status}`)
  }
  const data = (await res.json()) as DayMatch[]
  return data
}

export interface ProxyTarget {
  proxyPath: string | null
  directUrl: string
}

export function toProxyUrl(url: string): ProxyTarget {
  const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`
  const parsed = new URL(withProtocol)
  const path = `${parsed.pathname}${parsed.search}`
  switch (parsed.host) {
    case 'bwfworldtour.bwfbadminton.com':
      return { proxyPath: `/proxy/bwfworldtour${path}`, directUrl: withProtocol }
    case 'bwfbadminton.com':
      return { proxyPath: `/proxy/bwfbadminton${path}`, directUrl: withProtocol }
    case 'match-centre.bwfbadminton.com':
      return { proxyPath: `/proxy/match-centre${path}`, directUrl: withProtocol }
    case 'extranet-lv.bwfbadminton.com':
      return { proxyPath: `/proxy/extranet${path}`, directUrl: withProtocol }
    default:
      return { proxyPath: null, directUrl: withProtocol }
  }
}

const TOURNAMENT_TIMEZONE_HINTS: Array<{ pattern: RegExp; timeZone: string }> = [
  { pattern: /\b(india|syed modi|lucknow|guwahati|odisha|hyderabad|bengaluru|bangalore|chennai|mumbai|new delhi|pune|nagpur|raipur)\b/i, timeZone: 'Asia/Kolkata' },
  { pattern: /\b(germany|german|hylo|saarlandhalle|saarbrucken|saarbrücken|mulheim|mülheim|berlin|munich)\b/i, timeZone: 'Europe/Berlin' },
  { pattern: /\b(england|birmingham|london|glasgow|scottish|wales|welsh|cardiff)\b/i, timeZone: 'Europe/London' },
  { pattern: /\b(ireland|irish|dublin)\b/i, timeZone: 'Europe/Dublin' },
  { pattern: /\b(france|french|paris|orleans|orléans|lyon)\b/i, timeZone: 'Europe/Paris' },
  { pattern: /\b(spain|spanish|madrid|huelva|barcelona)\b/i, timeZone: 'Europe/Madrid' },
  { pattern: /\b(swiss|switzerland|basel|zurich)\b/i, timeZone: 'Europe/Zurich' },
  { pattern: /\b(denmark|danish|odense|copenhagen|horsens|aarhus)\b/i, timeZone: 'Europe/Copenhagen' },
  { pattern: /\b(finland|finnish|arctic open|vantaa|helsinki)\b/i, timeZone: 'Europe/Helsinki' },
  { pattern: /\b(sweden|swedish|uppsala|stockholm|malmo|malmö)\b/i, timeZone: 'Europe/Stockholm' },
  { pattern: /\b(poland|polish|warsaw|krakow|kraków)\b/i, timeZone: 'Europe/Warsaw' },
  { pattern: /\b(netherlands|dutch|almere|den bosch|amsterdam|rotterdam)\b/i, timeZone: 'Europe/Amsterdam' },
  { pattern: /\b(belgium|belgian|leuven|brussels)\b/i, timeZone: 'Europe/Brussels' },
  { pattern: /\b(portugal|portuguese|caldas da rainha|lisbon)\b/i, timeZone: 'Europe/Lisbon' },
  { pattern: /\b(turkey|turkiye|türkiye|ankara|istanbul)\b/i, timeZone: 'Europe/Istanbul' },
  { pattern: /\b(china|chinese|beijing|shenzhen|changzhou|ningbo|hangzhou|xiamen|chengdu|qingdao|wuhan|guangzhou|ruichang|baoji|shanghai)\b/i, timeZone: 'Asia/Shanghai' },
  { pattern: /\b(hong kong)\b/i, timeZone: 'Asia/Hong_Kong' },
  { pattern: /\b(taipei|kaohsiung|taiwan)\b/i, timeZone: 'Asia/Taipei' },
  { pattern: /\b(macau|macao)\b/i, timeZone: 'Asia/Macau' },
  { pattern: /\b(japan|japanese|tokyo|osaka|yokohama|kumamoto)\b/i, timeZone: 'Asia/Tokyo' },
  { pattern: /\b(korea|korean|seoul|suwon|yeosu|iksan|gwangju)\b/i, timeZone: 'Asia/Seoul' },
  { pattern: /\b(malaysia|malaysian|kuala lumpur|axiata|ipoh|johor|penang)\b/i, timeZone: 'Asia/Kuala_Lumpur' },
  { pattern: /\b(singapore)\b/i, timeZone: 'Asia/Singapore' },
  { pattern: /\b(bali|makassar|balikpapan)\b/i, timeZone: 'Asia/Makassar' },
  { pattern: /\b(indonesia|indonesian|jakarta|istora|surabaya|medan|yogyakarta|pekanbaru|bandung)\b/i, timeZone: 'Asia/Jakarta' },
  { pattern: /\b(thailand|thai|bangkok|nonthaburi|pathumwan)\b/i, timeZone: 'Asia/Bangkok' },
  { pattern: /\b(vietnam|vietnamese|ho chi minh|hanoi)\b/i, timeZone: 'Asia/Ho_Chi_Minh' },
  { pattern: /\b(philippines|philippine|manila)\b/i, timeZone: 'Asia/Manila' },
  { pattern: /\b(perth)\b/i, timeZone: 'Australia/Perth' },
  { pattern: /\b(brisbane|gold coast)\b/i, timeZone: 'Australia/Brisbane' },
  { pattern: /\b(adelaide)\b/i, timeZone: 'Australia/Adelaide' },
  { pattern: /\b(melbourne|bendigo)\b/i, timeZone: 'Australia/Melbourne' },
  { pattern: /\b(australia|australian|sydney)\b/i, timeZone: 'Australia/Sydney' },
  { pattern: /\b(new zealand|auckland|north harbour)\b/i, timeZone: 'Pacific/Auckland' },
  { pattern: /\b(calgary|edmonton|alberta)\b/i, timeZone: 'America/Edmonton' },
  { pattern: /\b(vancouver|british columbia)\b/i, timeZone: 'America/Vancouver' },
  { pattern: /\b(canada|canadian|markham|toronto|ottawa|montreal)\b/i, timeZone: 'America/Toronto' },
  { pattern: /\b(los angeles|california|anaheim|san diego)\b/i, timeZone: 'America/Los_Angeles' },
  { pattern: /\b(new york|boston|miami|orlando)\b/i, timeZone: 'America/New_York' },
  { pattern: /\b(usa|us open|united states|council bluffs|fort worth|texas|chicago)\b/i, timeZone: 'America/Chicago' },
  { pattern: /\b(brazil|brazilian|sao paulo|são paulo|rio de janeiro)\b/i, timeZone: 'America/Sao_Paulo' },
  { pattern: /\b(peru|peruvian|lima)\b/i, timeZone: 'America/Lima' },
  { pattern: /\b(mexico|mexican|guadalajara|aguascalientes|mexico city)\b/i, timeZone: 'America/Mexico_City' },
  { pattern: /\b(uae|dubai|abu dhabi|al ain)\b/i, timeZone: 'Asia/Dubai' },
  { pattern: /\b(saudi|riyadh|jeddah)\b/i, timeZone: 'Asia/Riyadh' },
  { pattern: /\b(bahrain)\b/i, timeZone: 'Asia/Bahrain' },
  { pattern: /\b(qatar|doha)\b/i, timeZone: 'Asia/Qatar' },
  { pattern: /\b(egypt|egyptian|cairo)\b/i, timeZone: 'Africa/Cairo' },
  { pattern: /\b(south africa|cape town|johannesburg|benoni)\b/i, timeZone: 'Africa/Johannesburg' },
  { pattern: /\b(uganda|ugandan|kampala)\b/i, timeZone: 'Africa/Kampala' },
  { pattern: /\b(kazakhstan|almaty|astana)\b/i, timeZone: 'Asia/Almaty' },
  { pattern: /\b(bangladesh|dhaka)\b/i, timeZone: 'Asia/Dhaka' },
  { pattern: /\b(sri lanka|colombo)\b/i, timeZone: 'Asia/Colombo' },
  { pattern: /\b(nepal|kathmandu)\b/i, timeZone: 'Asia/Kathmandu' },
  { pattern: /\b(mauritius)\b/i, timeZone: 'Indian/Mauritius' },
]

function parseApiDateTimeAsUtcMs(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim())
  if (!match) {
    return null
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    match[6] ? Number(match[6]) : 0,
  )
}

function formatUtcOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return 'UTC'
  }
  const sign = offsetMinutes > 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

function extractMatchOffset(matches: DayMatch[]): { offsetMinutes: number; utcInstant: Date } | null {
  for (const match of matches) {
    const localMs = parseApiDateTimeAsUtcMs(match.matchTime)
    const utcMs = parseApiDateTimeAsUtcMs(match.matchTimeUtc)
    if (localMs !== null && utcMs !== null) {
      const offsetMinutes = Math.round((localMs - utcMs) / 60000)
      if (offsetMinutes >= -12 * 60 && offsetMinutes <= 14 * 60) {
        return { offsetMinutes, utcInstant: new Date(utcMs) }
      }
    }
    if (match.matches && match.matches.length > 0) {
      const nested = extractMatchOffset(match.matches)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

/**
 * Infers the tournament's source timezone from match UTC offsets (`matchTime` vs `matchTimeUtc`)
 * and tournament metadata, returning an IANA timezone when matched or a fixed UTC offset string.
 */
export function inferTournamentTimeZone(tournament: BwfTournament, matches: DayMatch[]): string | null {
  const haystack = [tournament.name, tournament.slug, tournament.venue_name, tournament.venue_address1]
    .filter(Boolean)
    .join(' ')
  const offsetInfo = extractMatchOffset(matches)

  if (offsetInfo) {
    for (const hint of TOURNAMENT_TIMEZONE_HINTS) {
      if (!hint.pattern.test(haystack)) {
        continue
      }
      const candidateOffsetMinutes = Math.round(getTimeZoneOffsetMs(hint.timeZone, offsetInfo.utcInstant) / 60000)
      if (candidateOffsetMinutes === offsetInfo.offsetMinutes) {
        return hint.timeZone
      }
    }
    return formatUtcOffset(offsetInfo.offsetMinutes)
  }

  for (const hint of TOURNAMENT_TIMEZONE_HINTS) {
    if (hint.pattern.test(haystack)) {
      return hint.timeZone
    }
  }

  return null
}

const TRAILING_ISO_DATE_PATTERN = /(\d{4}-\d{2}-\d{2})$/
const TRAILING_DATE_WITH_OPTIONAL_SLASH_PATTERN = /(\/?\d{4}-\d{2}-\d{2})\/?$/
const EXPLICIT_SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z\d+.-]*):\/\//

function parseHttpUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return null
  }
  const schemeMatch = EXPLICIT_SCHEME_PATTERN.exec(trimmed)
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) {
    return null
  }
  const withProtocol = schemeMatch ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Extracts the trailing `YYYY-MM-DD` calendar date from `rawUrl` when present and valid. */
export function extractTrailingIsoDate(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()
  const match = TRAILING_ISO_DATE_PATTERN.exec(trimmed)
  if (!match) {
    return null
  }
  return isValidIsoDate(match[1]) ? match[1] : null
}

export type BwfUrlValidationResult =
  | { valid: true; normalizedUrl: string; date: string }
  | { valid: false; error: string }

/** Validates that `rawUrl` is an HTTP(S) URL ending with a valid `YYYY-MM-DD` date. */
export function validateBwfUrl(rawUrl: string): BwfUrlValidationResult {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return {
      valid: false,
      error: 'Please enter a BWF results page URL ending with a date in YYYY-MM-DD format.',
    }
  }
  const schemeMatch = EXPLICIT_SCHEME_PATTERN.exec(trimmed)
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) {
    return {
      valid: false,
      error: 'Please enter an HTTP or HTTPS URL ending with a YYYY-MM-DD date.',
    }
  }
  const parsed = parseHttpUrl(trimmed)
  if (!parsed) {
    return {
      valid: false,
      error: 'Please enter a valid URL ending with a YYYY-MM-DD date (for example .../results/2026-11-25).',
    }
  }
  const match = TRAILING_ISO_DATE_PATTERN.exec(trimmed)
  if (!match) {
    return {
      valid: false,
      error: 'The input URL must end with a date in YYYY-MM-DD format (for example .../results/2026-11-25), or pick a day below.',
    }
  }
  const date = match[1]
  if (!isValidIsoDate(date)) {
    return {
      valid: false,
      error: `The trailing date "${date}" is not a valid calendar date (YYYY-MM-DD).`,
    }
  }
  return { valid: true, normalizedUrl: trimmed, date }
}

/** Updates `rawUrl` so it ends with `isoDate` (`YYYY-MM-DD`), returning `null` if `rawUrl` cannot form a valid URL. */
export function applyDateToUrl(rawUrl: string, isoDate: string): string | null {
  if (!isValidIsoDate(isoDate)) {
    return null
  }
  const trimmed = rawUrl.trim()
  const parsed = parseHttpUrl(trimmed)
  if (!parsed) {
    return null
  }
  if (!parsed.search && !parsed.hash && TRAILING_DATE_WITH_OPTIONAL_SLASH_PATTERN.test(trimmed)) {
    return trimmed.replace(/(\d{4}-\d{2}-\d{2})\/?$/, isoDate)
  }
  const cleanPathname = parsed.pathname.replace(/(\/\d{4}-\d{2}-\d{2})?\/+$/, '')
  const base = `${parsed.origin}${cleanPathname}`
  return `${base}/${isoDate}`
}
