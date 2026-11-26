import type { BwfPlayer, BwfScoreSet, BwfTeam, DayMatch } from './bwf'
import {
  convertTimeText,
  formatDurationMinutes,
  formatLongDate,
  formatTimeOfDay,
  sourceWallTimeToInstant,
} from './time'

export const FIRST_MATCH_NOTIFY_LEAD_MS = 10 * 60 * 1000
export const FIRST_MATCH_NOTIFY_GRACE_MS = 15 * 60 * 1000
export const RECENT_PREV_FINISHED_WINDOW_MS = 2 * 60 * 60 * 1000
export const DEFAULT_MATCH_DURATION_MIN = 45
export const DEFAULT_SET_DURATION_MIN = 20
export const DEFAULT_MATCH_SLOT_MIN = 50
export const MATCH_CHANGEOVER_MIN = 8
export const ACTUAL_START_TIME_TTL_MS = 7 * 24 * 60 * 60 * 1000

const PINNED_STORAGE_KEY = 'bwf:pinned-matches:v1'
const SOUND_STORAGE_KEY = 'bwf:alert-sound:v1'
export const ACTUAL_START_STORAGE_KEY = 'bwf:actual-start-times:v1'
const MAX_PINNED_STORAGE_ITEMS = 200
const MAX_ACTUAL_START_TIME_ITEMS = 1000
const ACTUAL_START_FUTURE_SKEW_MS = 5 * 60 * 1000
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const REDUNDANT_OOP_TEXT_PATTERN = /^(?:starting\s+at(?:\b.*)?|followed\s+by\.?)$/i
const MAIN_LOCATION_PATTERN = /^main\s+location$/i

export type ActualStartTimesMap = Record<string, number>
export type ServingTeam = 1 | 2
export type ServingTeamsMap = Record<string, ServingTeam>

export interface MatchScoreSnapshot {
  setIndex: number
  home: number
  away: number
  servingTeam: ServingTeam | null
}

const LIVE_STATUS_CODES = new Set(['P', 'C', 'W', 'H'])
const FINISHED_STATUS_CODES = new Set(['F', 'O'])

export type MatchStatusTone = 'live' | 'waiting' | 'finished' | 'scheduled'
export type PinNotificationReason = 'first-match-schedule' | 'previous-match-finished'

export interface CountryOption {
  code: string
  name: string
  flagUrl: string | null
  matchCount: number
}

export interface MatchTimeView {
  match: DayMatch
  matchKey: string
  anchorId: string
  courtName: string
  courtOrderIndex: number
  previousMatchKey: string | null
  previousMatch: DayMatch | null
  sourceInstant: Date
  scheduledInstant: Date
  scheduledTimeLabel: string
  actualStartInstant: Date | null
  actualStartTimeLabel: string | null
  isActualStartTime: boolean
  isCalculatedStartTime: boolean
  localInstant: Date
  timeLabel: string
  dateLabel: string
  isTimeAdjusted: boolean
  adjustmentDeltaMinutes: number
  liveRemainingMinutes: number | null
  durationLabel: string | null
  durationLongLabel: string | null
  durationIso: string | null
  oopLabel: string
  statusLabel: string
  statusTone: MatchStatusTone
  countryCodes: string[]
  summary: string
}

export interface CourtFocusTarget {
  anchorId: string
  matchOrder: number
  kind: 'live' | 'last-finished'
  summary: string
  isFirstVisibleMatch: boolean
  remainingMatchesAfter: number
}

export interface CourtBlock {
  id: string
  name: string
  location: string
  matches: MatchTimeView[]
  liveCount: number
}

export interface MatchStartNotification {
  id: string
  matchKey: string
  anchorId: string
  courtName: string
  title: string
  body: string
  reason: PinNotificationReason
  createdAt: number
}

export interface PinnedMatchHint {
  label: string
  tone: 'soon' | 'live' | 'done' | 'waiting'
}

export function statusLabelFor(match: DayMatch): string {
  switch (match.matchStatus) {
    case 'F':
    case 'O':
      return 'Finished'
    case 'S':
      return 'Waiting to start'
    case 'C':
      return 'On court'
    case 'W':
      return 'Warm-up'
    case 'H':
      return 'Challenge'
    case 'P':
      return 'In progress'
    case 'N':
      return 'Scheduled'
    default:
      return match.matchStatusValue || 'Scheduled'
  }
}

export function isMatchFinished(match: DayMatch): boolean {
  return FINISHED_STATUS_CODES.has(match.matchStatus) || match.winner !== 0
}

export function isMatchLive(match: DayMatch): boolean {
  return LIVE_STATUS_CODES.has(match.matchStatus)
}

export function isMatchUpcoming(match: DayMatch): boolean {
  return !isMatchFinished(match) && !isMatchLive(match)
}

export function getMatchStatusTone(match: DayMatch): MatchStatusTone {
  if (isMatchLive(match)) {
    return 'live'
  }
  if (isMatchFinished(match)) {
    return 'finished'
  }
  if (match.matchStatus === 'S') {
    return 'waiting'
  }
  return 'scheduled'
}

function isUnplayedWalkover(match: DayMatch): boolean {
  if (match.matchStatus !== 'O') {
    return false
  }
  const hasScore = Array.isArray(match.score) && match.score.length > 0
  const hasDuration = typeof match.duration === 'number' && Number.isFinite(match.duration) && match.duration > 0
  return !hasScore && !hasDuration
}

export function getMatchKey(match: DayMatch, fallbackTournamentCode = ''): string {
  const scope = (match.tournamentCode || fallbackTournamentCode || 'tmt').trim()
  return `${scope}:${match.id}`
}

export function toMatchAnchorId(match: DayMatch): string {
  return `match-${match.id}`
}

export function toSafeHttpsUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function toSafeFlagUrl(url: string | null | undefined): string | null {
  return toSafeHttpsUrl(url)
}

export function playerDisplayName(player: BwfPlayer): string {
  return (
    player.nameDisplay?.trim() ||
    [player.firstName, player.lastName].filter(Boolean).join(' ').trim() ||
    player.nameShort?.trim() ||
    ''
  )
}

export function formatTeamSummary(team: BwfTeam): string {
  const names = (team.players ?? []).map(playerDisplayName).filter(Boolean)
  if (names.length > 0) {
    return names.join(' / ')
  }
  return team.teamName?.trim() || 'TBD'
}

export function formatMatchSummary(match: DayMatch): string {
  return `${formatTeamSummary(match.team1)} vs ${formatTeamSummary(match.team2)}`
}

export function extractMatchCountryCodes(match: DayMatch): string[] {
  const codes = new Set<string>()
  const collectTeam = (team: BwfTeam | null | undefined) => {
    if (!team) {
      return
    }
    const teamCode = team.countryCode?.trim().toUpperCase()
    if (teamCode) {
      codes.add(teamCode)
    }
    for (const player of team.players ?? []) {
      const playerCode = player.countryCode?.trim().toUpperCase()
      if (playerCode) {
        codes.add(playerCode)
      }
    }
  }
  collectTeam(match.team1)
  collectTeam(match.team2)
  return Array.from(codes)
}

export function buildCountryOptions(matches: DayMatch[]): CountryOption[] {
  const byCode = new Map<string, CountryOption>()

  for (const match of matches) {
    const seenInMatch = new Set<string>()
    const recordEntry = (
      rawCode: string | null | undefined,
      rawName: string | null | undefined,
      rawFlag: string | null | undefined,
    ) => {
      const code = rawCode?.trim().toUpperCase()
      if (!code) {
        return
      }
      const name = rawName?.trim() || ''
      const flagUrl = toSafeFlagUrl(rawFlag)
      let existing = byCode.get(code)
      if (!existing) {
        existing = { code, name: name || code, flagUrl, matchCount: 0 }
        byCode.set(code, existing)
      } else {
        if (existing.name === existing.code && name) {
          existing.name = name
        }
        if (!existing.flagUrl && flagUrl) {
          existing.flagUrl = flagUrl
        }
      }
      if (!seenInMatch.has(code)) {
        seenInMatch.add(code)
        existing.matchCount += 1
      }
    }

    const inspectTeam = (team: BwfTeam | null | undefined) => {
      if (!team) {
        return
      }
      for (const player of team.players ?? []) {
        recordEntry(player.countryCode, player.countryName, player.countryFlagUrl)
      }
      recordEntry(team.countryCode, null, team.countryFlagUrl)
    }

    inspectTeam(match.team1)
    inspectTeam(match.team2)
  }

  return Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
}

export function matchHasCountry(countryCodes: readonly string[], selectedCountry: string): boolean {
  const normalized = selectedCountry.trim().toUpperCase()
  if (!normalized) {
    return true
  }
  return countryCodes.includes(normalized)
}

function parseMatchTime(
  matchTime: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(matchTime)
  if (!match) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: 0, minute: 0, second: 0 }
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] ? Number(match[6]) : 0,
  }
}

/**
 * Parses BWF's `matchTimeUtc` string into a UTC `Date` instant when present and valid.
 * Preferring `matchTimeUtc` avoids BWF's half-hour timezone conversion bug in `matchTime`.
 */
function parseMatchTimeUtc(matchTimeUtc: string | null | undefined): Date | null {
  if (!matchTimeUtc) {
    return null
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z)?$/i.exec(
    matchTimeUtc.trim(),
  )
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] ? Number(match[6]) : 0
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null
  }
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    return null
  }
  return instant
}

export function toCourtId(name: string, usedIds: Set<string>): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = slug.startsWith('court') ? slug : `court-${slug || 'tbc'}`
  let candidate = base
  let suffix = 2
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(candidate)
  return candidate
}

function parseOopRound(oopRound: string | null | undefined): number | null {
  if (!oopRound) {
    return null
  }
  const trimmed = oopRound.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const num = Number.parseInt(trimmed, 10)
  return Number.isFinite(num) ? num : null
}

function compareMatchesInCourt(a: MatchTimeView, b: MatchTimeView): number {
  const roundA = parseOopRound(a.match.oopRound)
  const roundB = parseOopRound(b.match.oopRound)
  if (roundA !== null && roundB !== null && roundA !== roundB) {
    return roundA - roundB
  }
  const timeDiff = a.scheduledInstant.getTime() - b.scheduledInstant.getTime()
  if (timeDiff !== 0) {
    return timeDiff
  }
  const orderA = a.match.matchOrder ?? Number.MAX_SAFE_INTEGER
  const orderB = b.match.matchOrder ?? Number.MAX_SAFE_INTEGER
  if (orderA !== orderB) {
    return orderA - orderB
  }
  return a.match.id - b.match.id
}

interface ScoreSetEntry {
  home?: number
  away?: number
}

function isBadmintonSetComplete(home: number, away: number): boolean {
  const maxPts = Math.max(home, away)
  return (maxPts >= 21 && Math.abs(home - away) >= 2) || maxPts >= 30
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Formats a match's Order of Play (`oopText`) into the viewer's local timezone,
 * omitting redundant `"Starting At ..."` and `"Followed by"` labels.
 */
export function formatOopLabel(
  oopText: string | null | undefined,
  sourceTimeZone: string,
  contextDate: string,
): string {
  const trimmed = (oopText ?? '').trim()
  if (!trimmed || REDUNDANT_OOP_TEXT_PATTERN.test(trimmed)) {
    return ''
  }
  return convertTimeText(trimmed, sourceTimeZone, contextDate)
}

/**
 * Estimates remaining play minutes for an in-progress match from its status, elapsed duration, and set scores.
 */
export function estimateRemainingMatchMinutes(match: DayMatch, fallbackElapsedMin = 0): number {
  if (match.matchStatus === 'C' || match.matchStatus === 'W') {
    return DEFAULT_MATCH_DURATION_MIN
  }

  const rawSets = (match.score ?? []) as ScoreSetEntry[]
  const apiElapsedMin = typeof match.duration === 'number' && match.duration > 0 ? match.duration : 0
  const elapsedMin = apiElapsedMin > 0 ? apiElapsedMin : Math.max(0, fallbackElapsedMin)

  if (rawSets.length === 0) {
    return Math.max(10, DEFAULT_MATCH_DURATION_MIN - elapsedMin)
  }

  let homeSets = 0
  let awaySets = 0
  let activeSet: { home: number; away: number } | null = null

  rawSets.forEach((set, index) => {
    const home = Number(set.home ?? 0)
    const away = Number(set.away ?? 0)
    const isLast = index === rawSets.length - 1
    if (!isLast || isBadmintonSetComplete(home, away)) {
      if (home > away) {
        homeSets += 1
      } else if (away > home) {
        awaySets += 1
      }
    } else {
      activeSet = { home, away }
    }
  })

  if (homeSets >= 2 || awaySets >= 2) {
    return 1
  }

  const completedSets = homeSets + awaySets
  const activeProgress = activeSet
    ? Math.min(0.95, Math.max((activeSet as { home: number; away: number }).home, (activeSet as { home: number; away: number }).away) / 21)
    : 0
  const progressInSets = completedSets + activeProgress

  const pacePerSetMin =
    elapsedMin >= 5 && progressInSets >= 0.3
      ? clampNumber(elapsedMin / progressInSets, 15, 30)
      : DEFAULT_SET_DURATION_MIN

  let remainingCurrentSetMin = pacePerSetMin
  if (activeSet) {
    const { home, away } = activeSet as { home: number; away: number }
    const maxPts = Math.max(home, away)
    const diff = Math.abs(home - away)
    if (maxPts >= 20 && diff < 2) {
      remainingCurrentSetMin = 3
    } else {
      remainingCurrentSetMin = Math.max(2, (1 - Math.min(0.95, maxPts / 21)) * pacePerSetMin)
    }
  }

  let additionalSets = 0
  if (completedSets === 0) {
    additionalSets = 1
  } else if (completedSets === 1) {
    if (activeSet) {
      const { home, away } = activeSet as { home: number; away: number }
      const set1WinnerIsHome = homeSets === 1
      const set1LoserPts = set1WinnerIsHome ? away : home
      const set1WinnerPts = set1WinnerIsHome ? home : away
      if (set1LoserPts - set1WinnerPts >= 4 && set1LoserPts >= 11) {
        additionalSets = 0.85
      } else if (set1LoserPts > set1WinnerPts) {
        additionalSets = 0.4
      }
    } else {
      additionalSets = 0.3
    }
  }

  return Math.max(1, Math.round(remainingCurrentSetMin + additionalSets * pacePerSetMin))
}

function roundToMinuteMs(ms: number): number {
  return Math.round(ms / 60_000) * 60_000
}

function parseServingSide(value: number | string | null | undefined): ServingTeam | null {
  if (value === 1 || value === 2) {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '1' || normalized === 'home' || normalized === 'team1') {
      return 1
    }
    if (normalized === '2' || normalized === 'away' || normalized === 'team2') {
      return 2
    }
  }
  return null
}

function getExplicitServingTeam(match: DayMatch, sets: readonly BwfScoreSet[]): ServingTeam | null {
  const activeSet = sets.length > 0 ? sets[sets.length - 1] : null
  const fromActiveSet =
    parseServingSide(activeSet?.serve) ??
    parseServingSide(activeSet?.service) ??
    parseServingSide(activeSet?.lastPointWinner)
  if (fromActiveSet !== null) {
    return fromActiveSet
  }
  return parseServingSide(match.serve) ?? parseServingSide(match.service)
}

/**
 * Resolves the currently serving team (`1` or `2`) for an in-progress match.
 * Prefers explicit API fields (`serve`, `service`, `lastPointWinner`), then falls back to
 * score-delta comparison across refreshes and badminton set-start rules.
 */
export function resolveServingTeamForMatch(
  match: DayMatch,
  previousSnapshot?: MatchScoreSnapshot,
): { servingTeam: ServingTeam | null; snapshot: MatchScoreSnapshot | null } {
  if (!isMatchLive(match) || isMatchFinished(match)) {
    return { servingTeam: null, snapshot: null }
  }

  const sets = Array.isArray(match.score) ? match.score : []
  const explicit = getExplicitServingTeam(match, sets)

  if (sets.length === 0) {
    return {
      servingTeam: explicit,
      snapshot: explicit ? { setIndex: -1, home: 0, away: 0, servingTeam: explicit } : null,
    }
  }

  const setIndex = sets.length - 1
  const activeSet = sets[setIndex]
  const home = Number(activeSet?.home ?? 0)
  const away = Number(activeSet?.away ?? 0)

  let servingTeam: ServingTeam | null = explicit

  if (servingTeam === null) {
    let homeSetsWon = 0
    let awaySetsWon = 0
    for (let i = 0; i < sets.length; i += 1) {
      const h = Number(sets[i]?.home ?? 0)
      const a = Number(sets[i]?.away ?? 0)
      if (i < setIndex || isBadmintonSetComplete(h, a)) {
        if (h > a) {
          homeSetsWon += 1
        } else if (a > h) {
          awaySetsWon += 1
        }
      }
    }

    if (isBadmintonSetComplete(home, away)) {
      if (homeSetsWon < 2 && awaySetsWon < 2 && home !== away) {
        servingTeam = home > away ? 1 : 2
      }
    } else if (previousSnapshot && previousSnapshot.setIndex === setIndex) {
      const deltaHome = home - previousSnapshot.home
      const deltaAway = away - previousSnapshot.away
      if (deltaHome > 0 && deltaAway === 0) {
        servingTeam = 1
      } else if (deltaAway > 0 && deltaHome === 0) {
        servingTeam = 2
      } else if (deltaHome === 0 && deltaAway === 0) {
        servingTeam = previousSnapshot.servingTeam
      }
    } else if (home > 0 && away === 0) {
      servingTeam = 1
    } else if (away > 0 && home === 0) {
      servingTeam = 2
    } else if (home === 0 && away === 0 && setIndex > 0) {
      const prevSet = sets[setIndex - 1]
      const prevHome = Number(prevSet?.home ?? 0)
      const prevAway = Number(prevSet?.away ?? 0)
      if (prevHome !== prevAway) {
        servingTeam = prevHome > prevAway ? 1 : 2
      }
    }
  }

  return {
    servingTeam,
    snapshot: { setIndex, home, away, servingTeam },
  }
}

/**
 * Evaluates serving indicators for all live matches in a schedule fetch, updating the
 * per-match score snapshot map so indicators remain accurate and persistent across refreshes.
 */
export function resolveServingTeamsForMatches(
  matches: readonly DayMatch[],
  tournamentCode: string,
  previousSnapshots: ReadonlyMap<string, MatchScoreSnapshot>,
): { servingTeams: ServingTeamsMap; snapshots: Map<string, MatchScoreSnapshot> } {
  const servingTeams: ServingTeamsMap = {}
  const snapshots = new Map<string, MatchScoreSnapshot>()

  for (const match of matches) {
    const matchKey = getMatchKey(match, tournamentCode)
    const { servingTeam, snapshot } = resolveServingTeamForMatch(match, previousSnapshots.get(matchKey))
    if (servingTeam !== null) {
      servingTeams[matchKey] = servingTeam
    }
    if (snapshot !== null) {
      snapshots.set(matchKey, snapshot)
    }
  }

  return { servingTeams, snapshots }
}

function adjustCourtTimesForLiveMatch(courtList: MatchTimeView[], localTz: string, nowMs: number): void {
  let liveIdx = -1
  for (let i = courtList.length - 1; i >= 0; i -= 1) {
    if (isMatchLive(courtList[i].match)) {
      liveIdx = i
      break
    }
  }

  let startAfterIdx = liveIdx
  let cursorStartMs = 0
  let lastPlacedIdx = -1

  if (liveIdx !== -1) {
    const liveView = courtList[liveIdx]
    const liveReferenceMs = liveView.actualStartInstant?.getTime() ?? liveView.localInstant.getTime()
    const isWithinLiveWindow = Math.abs(nowMs - liveReferenceMs) <= 12 * 60 * 60 * 1000
    const inferredElapsedMin =
      (liveView.actualStartInstant !== null || liveView.isCalculatedStartTime) && isWithinLiveWindow
        ? Math.max(0, Math.round((nowMs - liveReferenceMs) / 60_000))
        : 0
    const remainingMin = estimateRemainingMatchMinutes(liveView.match, inferredElapsedMin)
    liveView.liveRemainingMinutes = remainingMin

    const apiElapsedMin =
      typeof liveView.match.duration === 'number' && liveView.match.duration > 0 ? liveView.match.duration : 0
    const elapsedMin = apiElapsedMin > 0 ? apiElapsedMin : inferredElapsedMin
    const liveNowMs = isWithinLiveWindow ? nowMs : liveReferenceMs + elapsedMin * 60_000
    const estimatedLiveEndMs = liveNowMs + remainingMin * 60_000

    cursorStartMs = roundToMinuteMs(estimatedLiveEndMs + MATCH_CHANGEOVER_MIN * 60_000)
  } else {
    let calculatedUpcomingIdx = -1
    for (let i = courtList.length - 1; i >= 0; i -= 1) {
      const candidate = courtList[i]
      if (candidate.isCalculatedStartTime && isMatchUpcoming(candidate.match)) {
        calculatedUpcomingIdx = i
        break
      }
    }
    if (calculatedUpcomingIdx === -1) {
      return
    }
    const anchorView = courtList[calculatedUpcomingIdx]
    const anchorMs = anchorView.localInstant.getTime()
    const isWithinLiveWindow = Math.abs(nowMs - anchorMs) <= 12 * 60 * 60 * 1000
    const effectiveAnchorMs = isWithinLiveWindow ? Math.max(anchorMs, roundToMinuteMs(nowMs)) : anchorMs
    if (effectiveAnchorMs !== anchorMs) {
      const updatedInstant = new Date(effectiveAnchorMs)
      const deltaMin = Math.round((effectiveAnchorMs - anchorView.scheduledInstant.getTime()) / 60_000)
      anchorView.sourceInstant = updatedInstant
      anchorView.localInstant = updatedInstant
      anchorView.timeLabel = formatTimeOfDay(updatedInstant, localTz)
      anchorView.dateLabel = formatLongDate(updatedInstant, localTz)
      anchorView.isTimeAdjusted = deltaMin !== 0
      anchorView.adjustmentDeltaMinutes = deltaMin
    }
    startAfterIdx = calculatedUpcomingIdx
    cursorStartMs = effectiveAnchorMs
    lastPlacedIdx = calculatedUpcomingIdx
  }

  for (let i = startAfterIdx + 1; i < courtList.length; i += 1) {
    const current = courtList[i]
    if (
      isMatchFinished(current.match) ||
      isMatchLive(current.match) ||
      current.isActualStartTime ||
      current.isCalculatedStartTime
    ) {
      continue
    }

    let candidateMs = cursorStartMs
    const hasTimeFloor = current.match.oopTypeId === 1 || current.match.oopTypeId === 2

    if (lastPlacedIdx !== -1) {
      const prevScheduledMs = courtList[lastPlacedIdx].scheduledInstant.getTime()
      const currScheduledMs = current.scheduledInstant.getTime()
      const rawGapMs = currScheduledMs - prevScheduledMs
      const defaultSlotMs = DEFAULT_MATCH_SLOT_MIN * 60_000
      const maxSlotMs = 75 * 60_000
      let slotDurationMs =
        rawGapMs >= 15 * 60_000 && rawGapMs <= maxSlotMs ? rawGapMs : defaultSlotMs
      if (hasTimeFloor && slotDurationMs > defaultSlotMs) {
        slotDurationMs = defaultSlotMs
      }
      candidateMs = cursorStartMs + slotDurationMs
    }

    const adjustedMs = hasTimeFloor
      ? Math.max(current.scheduledInstant.getTime(), candidateMs)
      : candidateMs

    cursorStartMs = adjustedMs
    lastPlacedIdx = i

    const deltaMin = Math.round((adjustedMs - current.scheduledInstant.getTime()) / 60_000)
    if (deltaMin !== 0) {
      const adjustedInstant = new Date(adjustedMs)
      current.sourceInstant = adjustedInstant
      current.localInstant = adjustedInstant
      current.timeLabel = formatTimeOfDay(adjustedInstant, localTz)
      current.dateLabel = formatLongDate(adjustedInstant, localTz)
      current.isTimeAdjusted = true
      current.adjustmentDeltaMinutes = deltaMin
    }
  }
}

export function buildOrderedScheduleViews(
  matches: DayMatch[],
  sourceTimeZone: string,
  contextDate: string,
  localTz: string,
  tournamentCode = '',
  nowMs: number = Date.now(),
  actualStartTimes: Readonly<ActualStartTimesMap> = {},
): MatchTimeView[] {
  const byCourt = new Map<string, MatchTimeView[]>()

  for (const match of matches) {
    const courtName = match.courtName && match.courtName.trim() !== '' ? match.courtName.trim() : 'Court TBC'
    const matchKey = getMatchKey(match, tournamentCode)
    const utcInstant = parseMatchTimeUtc(match.matchTimeUtc)
    const instant =
      utcInstant ??
      (() => {
        const parts = parseMatchTime(match.matchTime)
        return sourceWallTimeToInstant(
          parts.year,
          parts.month,
          parts.day,
          parts.hour,
          parts.minute,
          parts.second,
          sourceTimeZone,
        )
      })()
    const formattedScheduledTime = formatTimeOfDay(instant, localTz)
    const rawActualStartMs = Object.hasOwn(actualStartTimes, matchKey) ? actualStartTimes[matchKey] : undefined
    const canShowActualStart =
      (isMatchLive(match) || isMatchFinished(match)) &&
      !isUnplayedWalkover(match) &&
      typeof rawActualStartMs === 'number' &&
      Number.isFinite(rawActualStartMs)
    const actualStartInstant = canShowActualStart ? new Date(rawActualStartMs) : null
    const actualStartTimeLabel = actualStartInstant ? formatTimeOfDay(actualStartInstant, localTz) : null
    const displayInstant = actualStartInstant ?? instant
    const formattedDuration = isMatchFinished(match) ? formatDurationMinutes(match.duration) : null

    const view: MatchTimeView = {
      match,
      matchKey,
      anchorId: toMatchAnchorId(match),
      courtName,
      courtOrderIndex: 0,
      previousMatchKey: null,
      previousMatch: null,
      sourceInstant: instant,
      scheduledInstant: instant,
      scheduledTimeLabel: formattedScheduledTime,
      actualStartInstant,
      actualStartTimeLabel,
      isActualStartTime: actualStartInstant !== null,
      isCalculatedStartTime: false,
      localInstant: displayInstant,
      timeLabel: actualStartTimeLabel ?? formattedScheduledTime,
      dateLabel: formatLongDate(displayInstant, localTz),
      isTimeAdjusted: false,
      adjustmentDeltaMinutes: 0,
      liveRemainingMinutes: null,
      durationLabel: formattedDuration?.label ?? null,
      durationLongLabel: formattedDuration?.longLabel ?? null,
      durationIso: formattedDuration?.iso ?? null,
      oopLabel: formatOopLabel(match.oopText, sourceTimeZone, contextDate),
      statusLabel: statusLabelFor(match),
      statusTone: getMatchStatusTone(match),
      countryCodes: extractMatchCountryCodes(match),
      summary: formatMatchSummary(match),
    }

    const list = byCourt.get(courtName)
    if (list) {
      list.push(view)
    } else {
      byCourt.set(courtName, [view])
    }
  }

  const orderedViews: MatchTimeView[] = []
  for (const courtList of byCourt.values()) {
    courtList.sort(compareMatchesInCourt)
    for (let i = 0; i < courtList.length; i += 1) {
      const current = courtList[i]
      current.courtOrderIndex = i
      if (i > 0) {
        const previous = courtList[i - 1]
        current.previousMatch = previous.match
        current.previousMatchKey = previous.matchKey

        const prevDurationMin = previous.match.duration
        if (
          !current.isActualStartTime &&
          !isUnplayedWalkover(current.match) &&
          isMatchFinished(previous.match) &&
          !isUnplayedWalkover(previous.match) &&
          typeof prevDurationMin === 'number' &&
          Number.isFinite(prevDurationMin) &&
          prevDurationMin > 0
        ) {
          const prevStartMs = previous.localInstant.getTime()
          const candidateMs = roundToMinuteMs(
            prevStartMs + (Math.round(prevDurationMin) + MATCH_CHANGEOVER_MIN) * 60_000,
          )
          const hasTimeFloor = current.match.oopTypeId === 1 || current.match.oopTypeId === 2
          const calculatedMs = hasTimeFloor
            ? Math.max(current.scheduledInstant.getTime(), candidateMs)
            : candidateMs
          const calculatedInstant = new Date(calculatedMs)
          const deltaMin = Math.round((calculatedMs - current.scheduledInstant.getTime()) / 60_000)
          current.sourceInstant = calculatedInstant
          current.localInstant = calculatedInstant
          current.timeLabel = formatTimeOfDay(calculatedInstant, localTz)
          current.dateLabel = formatLongDate(calculatedInstant, localTz)
          current.isCalculatedStartTime = true
          current.isTimeAdjusted = deltaMin !== 0
          current.adjustmentDeltaMinutes = deltaMin
        }
      }
    }
    adjustCourtTimesForLiveMatch(courtList, localTz, nowMs)
    orderedViews.push(...courtList)
  }

  return orderedViews
}

function resolveCourtLocation(locationName: string | null | undefined, fallbackVenue: string): string {
  const trimmedLocation = (locationName ?? '').trim()
  if (trimmedLocation) {
    return MAIN_LOCATION_PATTERN.test(trimmedLocation) ? '' : trimmedLocation
  }
  const trimmedFallback = fallbackVenue.trim()
  return trimmedFallback && !MAIN_LOCATION_PATTERN.test(trimmedFallback) ? trimmedFallback : ''
}

export function groupViewsByCourt(views: MatchTimeView[], fallbackVenue: string): CourtBlock[] {
  const ordered: CourtBlock[] = []
  const courtIndex = new Map<string, number>()
  const usedIds = new Set<string>()

  for (const view of views) {
    const name = view.courtName
    let blockIdx = courtIndex.get(name)
    if (blockIdx === undefined) {
      blockIdx = ordered.length
      courtIndex.set(name, blockIdx)
      ordered.push({
        id: toCourtId(name, usedIds),
        name,
        location: resolveCourtLocation(view.match.locationName, fallbackVenue),
        matches: [],
        liveCount: 0,
      })
    }
    ordered[blockIdx].matches.push(view)
    if (isMatchLive(view.match)) {
      ordered[blockIdx].liveCount += 1
    }
  }

  for (const block of ordered) {
    block.matches.sort((a, b) => a.courtOrderIndex - b.courtOrderIndex)
  }

  return ordered
}

/**
 * Picks the match a court navigator link should focus on:
 * 1. The active in-progress match on the court (preferring 'P'/'H' over warm-up/on-court if multiple exist).
 * 2. Otherwise the last finished match in court order (avoiding jumping past unplayed matches to an advance walkover 'O' when an earlier finished match exists).
 * 3. Otherwise null (caller falls back to the court section heading).
 */
export function findCourtFocusTarget(matches: readonly MatchTimeView[]): CourtFocusTarget | null {
  if (matches.length === 0) {
    return null
  }

  let liveIdx = -1
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const status = matches[i].match.matchStatus
    if (status === 'P' || status === 'H') {
      liveIdx = i
      break
    }
  }
  if (liveIdx === -1) {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      if (isMatchLive(matches[i].match)) {
        liveIdx = i
        break
      }
    }
  }
  if (liveIdx !== -1) {
    const view = matches[liveIdx]
    return {
      anchorId: view.anchorId,
      matchOrder: view.courtOrderIndex + 1,
      kind: 'live',
      summary: view.summary,
      isFirstVisibleMatch: liveIdx === 0,
      remainingMatchesAfter: matches.length - 1 - liveIdx,
    }
  }

  let preferredFinishedIdx = -1
  let fallbackFinishedIdx = -1
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const view = matches[i]
    if (!isMatchFinished(view.match)) {
      continue
    }
    if (fallbackFinishedIdx === -1) {
      fallbackFinishedIdx = i
    }
    const isWalkover = isUnplayedWalkover(view.match)
    const allEarlierFinished = matches.slice(0, i).every((prev) => isMatchFinished(prev.match))
    if (!isWalkover || allEarlierFinished) {
      preferredFinishedIdx = i
      break
    }
  }

  const finishedIdx = preferredFinishedIdx !== -1 ? preferredFinishedIdx : fallbackFinishedIdx
  if (finishedIdx !== -1) {
    const view = matches[finishedIdx]
    return {
      anchorId: view.anchorId,
      matchOrder: view.courtOrderIndex + 1,
      kind: 'last-finished',
      summary: view.summary,
      isFirstVisibleMatch: finishedIdx === 0,
      remainingMatchesAfter: matches.length - 1 - finishedIdx,
    }
  }

  return null
}

export interface EvaluatePinNotificationsParams {
  allViews: readonly MatchTimeView[]
  pinnedKeys: ReadonlySet<string>
  notifiedKeys: ReadonlySet<string>
  previousFinishedByKey: ReadonlyMap<string, boolean>
  previousStatusByKey: ReadonlyMap<string, string>
  nowMs: number
}

/**
 * Evaluates pinned upcoming matches and returns notifications for matches that are about to start:
 * - First match on its court schedule: triggers via scheduled time within the lead window.
 * - Subsequent match on its court schedule: triggers when the match immediately before it has just finished.
 */
export function evaluatePinnedMatchNotifications({
  allViews,
  pinnedKeys,
  notifiedKeys,
  previousFinishedByKey,
  previousStatusByKey,
  nowMs,
}: EvaluatePinNotificationsParams): MatchStartNotification[] {
  const notifications: MatchStartNotification[] = []

  for (const view of allViews) {
    if (!pinnedKeys.has(view.matchKey) || notifiedKeys.has(view.matchKey)) {
      continue
    }
    if (!isMatchUpcoming(view.match)) {
      continue
    }

    if (view.courtOrderIndex === 0) {
      const msUntilStart = view.sourceInstant.getTime() - nowMs
      if (msUntilStart <= FIRST_MATCH_NOTIFY_LEAD_MS && msUntilStart >= -FIRST_MATCH_NOTIFY_GRACE_MS) {
        let timing: string
        if (msUntilStart > 60_000) {
          const mins = Math.ceil(msUntilStart / 60_000)
          timing = `Starts in ${mins} min (${view.timeLabel})`
        } else if (msUntilStart > 0) {
          timing = `Starts in less than a minute (${view.timeLabel})`
        } else {
          timing = `Scheduled to start now (${view.timeLabel})`
        }
        notifications.push({
          id: `${view.matchKey}:first:${nowMs}`,
          matchKey: view.matchKey,
          anchorId: view.anchorId,
          courtName: view.courtName,
          title: `Match starting soon · ${view.courtName}`,
          body: `${view.summary} — ${timing}.`,
          reason: 'first-match-schedule',
          createdAt: nowMs,
        })
      }
      continue
    }

    if (view.previousMatch && view.previousMatchKey) {
      const prevFinishedNow = isMatchFinished(view.previousMatch)
      if (!prevFinishedNow) {
        continue
      }

      const wasPrevFinished = previousFinishedByKey.get(view.previousMatchKey)
      const prevJustFinished = wasPrevFinished === false
      const prevMatchStatus = previousStatusByKey.get(view.matchKey)
      const enteredWaitingState = prevMatchStatus !== undefined && prevMatchStatus !== 'S' && view.match.matchStatus === 'S'
      const firstObservedReady =
        wasPrevFinished === undefined &&
        (view.match.matchStatus === 'S' || Math.abs(view.sourceInstant.getTime() - nowMs) <= RECENT_PREV_FINISHED_WINDOW_MS)

      if (prevJustFinished || enteredWaitingState || firstObservedReady) {
        const prevSummary = formatMatchSummary(view.previousMatch)
        notifications.push({
          id: `${view.matchKey}:prev:${nowMs}`,
          matchKey: view.matchKey,
          anchorId: view.anchorId,
          courtName: view.courtName,
          title: `Up next on ${view.courtName}`,
          body: `${view.summary} — Previous match (${prevSummary}) just finished.`,
          reason: 'previous-match-finished',
          createdAt: nowMs,
        })
      }
    }
  }

  return notifications
}

export function getPinnedMatchHint(view: MatchTimeView, nowMs: number): PinnedMatchHint {
  if (isMatchFinished(view.match)) {
    return { label: 'Finished', tone: 'done' }
  }
  if (isMatchLive(view.match)) {
    const label =
      view.liveRemainingMinutes !== null
        ? `${view.statusLabel} · ~${view.liveRemainingMinutes}m left`
        : view.statusLabel
    return { label, tone: 'live' }
  }
  if (view.courtOrderIndex === 0) {
    const msUntilStart = view.sourceInstant.getTime() - nowMs
    if (msUntilStart <= FIRST_MATCH_NOTIFY_LEAD_MS && msUntilStart >= -FIRST_MATCH_NOTIFY_GRACE_MS) {
      const label = msUntilStart > 60_000 ? `Starts in ${Math.ceil(msUntilStart / 60_000)}m` : 'Starting now'
      return { label, tone: 'soon' }
    }
    return { label: `1st on court · ${view.timeLabel}`, tone: 'waiting' }
  }
  if (view.previousMatch) {
    if (isMatchFinished(view.previousMatch)) {
      return { label: 'Up next · prev finished', tone: 'soon' }
    }
    if (isMatchLive(view.previousMatch)) {
      return {
        label: view.isTimeAdjusted ? `After live · Est. ${view.timeLabel}` : 'After live match',
        tone: 'waiting',
      }
    }
  }
  const timePart = view.isTimeAdjusted ? `Est. ${view.timeLabel}` : view.timeLabel
  return { label: `#${view.courtOrderIndex + 1} on court · ${timePart}`, tone: 'waiting' }
}

export function loadPinnedMatchKeys(): string[] {
  if (typeof window === 'undefined') {
    return []
  }
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 160)
      .slice(0, MAX_PINNED_STORAGE_ITEMS)
  } catch {
    return []
  }
}

export function savePinnedMatchKeys(keys: readonly string[]): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const safeKeys = keys.filter((k) => k.length > 0 && k.length <= 160).slice(0, MAX_PINNED_STORAGE_ITEMS)
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(safeKeys))
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

export function loadAlertSoundEnabled(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  try {
    const raw = window.localStorage.getItem(SOUND_STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export function saveAlertSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

export interface DetectNewlyStartedParams {
  matches: readonly DayMatch[]
  tournamentCode: string
  previousUpcomingByKey: ReadonlyMap<string, boolean>
  existingActualStartTimes: Readonly<ActualStartTimesMap>
  nowMs: number
}

/**
 * Detects matches that transitioned from an upcoming/scheduled state (`N` / `S`) into an active
 * court state (`C` On court, `W` Warm-up, `P` In progress, `H` Challenge) and returns newly
 * captured actual start timestamps (`matchKey -> epoch ms`).
 */
export function detectNewlyStartedMatchTimes({
  matches,
  tournamentCode,
  previousUpcomingByKey,
  existingActualStartTimes,
  nowMs,
}: DetectNewlyStartedParams): ActualStartTimesMap {
  const captured: ActualStartTimesMap = {}
  const roundedNow = Math.round(nowMs)
  for (const match of matches) {
    const matchKey = getMatchKey(match, tournamentCode)
    if (Object.hasOwn(existingActualStartTimes, matchKey)) {
      continue
    }
    if (previousUpcomingByKey.get(matchKey) === true && isMatchLive(match) && !isMatchFinished(match)) {
      captured[matchKey] = roundedNow
    }
  }
  return captured
}

/**
 * Filters a raw persisted map of actual start times, dropping invalid entries,
 * expired records older than `ACTUAL_START_TIME_TTL_MS` (7 days), and capping total size.
 */
export function pruneActualStartTimes(
  entries: Readonly<Record<string, unknown>>,
  nowMs: number = Date.now(),
): ActualStartTimesMap {
  const minAllowed = nowMs - ACTUAL_START_TIME_TTL_MS
  const maxAllowed = nowMs + ACTUAL_START_FUTURE_SKEW_MS
  const valid: Array<[string, number]> = []

  for (const [key, value] of Object.entries(entries)) {
    if (
      key.length === 0 ||
      key.length > 160 ||
      UNSAFE_OBJECT_KEYS.has(key) ||
      typeof value !== 'number' ||
      !Number.isFinite(value)
    ) {
      continue
    }
    const rounded = Math.round(value)
    if (rounded >= minAllowed && rounded <= maxAllowed) {
      valid.push([key, rounded])
    }
  }

  if (valid.length > MAX_ACTUAL_START_TIME_ITEMS) {
    valid.sort((a, b) => b[1] - a[1])
    valid.length = MAX_ACTUAL_START_TIME_ITEMS
  }

  const pruned: ActualStartTimesMap = {}
  for (const [key, timestamp] of valid) {
    pruned[key] = timestamp
  }
  return pruned
}

export function loadActualStartTimes(nowMs: number = Date.now()): ActualStartTimesMap {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(ACTUAL_START_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const record = parsed as Record<string, unknown>
    const pruned = pruneActualStartTimes(record, nowMs)
    if (Object.keys(pruned).length !== Object.keys(record).length) {
      try {
        window.localStorage.setItem(ACTUAL_START_STORAGE_KEY, JSON.stringify(pruned))
      } catch {
        // Ignore storage quota / private mode failures during pruning.
      }
    }
    return pruned
  } catch {
    return {}
  }
}

export function saveActualStartTimes(
  entries: Readonly<ActualStartTimesMap>,
  nowMs: number = Date.now(),
): ActualStartTimesMap {
  const pruned = pruneActualStartTimes(entries, nowMs)
  if (typeof window === 'undefined') {
    return pruned
  }
  try {
    window.localStorage.setItem(ACTUAL_START_STORAGE_KEY, JSON.stringify(pruned))
  } catch {
    // Ignore storage quota / private mode failures.
  }
  return pruned
}

export function subscribeActualStartTimesStorage(onChange: (next: ActualStartTimesMap) => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }
  const listener = (event: StorageEvent) => {
    if (event.key !== ACTUAL_START_STORAGE_KEY && event.key !== null) {
      return
    }
    onChange(loadActualStartTimes())
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

export function playNotificationChime(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      return
    }
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [880, 1174.66]
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + idx * 0.11)
      gain.gain.setValueAtTime(0.0001, now + idx * 0.11)
      gain.gain.exponentialRampToValueAtTime(0.055, now + idx * 0.11 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 0.18)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + idx * 0.11)
      osc.stop(now + idx * 0.11 + 0.2)
    })
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined)
    }, 600)
  } catch {
    // Audio playback may be blocked until user interaction; ignore cleanly.
  }
}
