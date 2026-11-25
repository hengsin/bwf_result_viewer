import type { BwfPlayer, BwfTeam, DayMatch } from './bwf'
import {
  convertTimeText,
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
export const MATCH_CHANGEOVER_MIN = 5

const PINNED_STORAGE_KEY = 'bwf:pinned-matches:v1'
const SOUND_STORAGE_KEY = 'bwf:alert-sound:v1'
const MAX_PINNED_STORAGE_ITEMS = 200

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
  localInstant: Date
  timeLabel: string
  dateLabel: string
  isTimeAdjusted: boolean
  adjustmentDeltaMinutes: number
  liveRemainingMinutes: number | null
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
 * Estimates remaining play minutes for an in-progress match from its status, elapsed duration, and set scores.
 */
export function estimateRemainingMatchMinutes(match: DayMatch): number {
  if (match.matchStatus === 'C' || match.matchStatus === 'W') {
    return DEFAULT_MATCH_DURATION_MIN
  }

  const rawSets = (match.score ?? []) as ScoreSetEntry[]
  const elapsedMin = typeof match.duration === 'number' && match.duration > 0 ? match.duration : 0

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

function adjustCourtTimesForLiveMatch(courtList: MatchTimeView[], localTz: string, nowMs: number): void {
  let liveIdx = -1
  for (let i = courtList.length - 1; i >= 0; i -= 1) {
    if (isMatchLive(courtList[i].match)) {
      liveIdx = i
      break
    }
  }

  if (liveIdx === -1) {
    return
  }

  const liveView = courtList[liveIdx]
  const remainingMin = estimateRemainingMatchMinutes(liveView.match)
  liveView.liveRemainingMinutes = remainingMin

  const scheduledLiveMs = liveView.scheduledInstant.getTime()
  const elapsedMin =
    typeof liveView.match.duration === 'number' && liveView.match.duration > 0 ? liveView.match.duration : 0
  const isWithinLiveWindow = Math.abs(nowMs - scheduledLiveMs) <= 12 * 60 * 60 * 1000
  const liveNowMs = isWithinLiveWindow ? nowMs : scheduledLiveMs + elapsedMin * 60_000
  const estimatedLiveEndMs = liveNowMs + remainingMin * 60_000

  let cursorStartMs = roundToMinuteMs(estimatedLiveEndMs + MATCH_CHANGEOVER_MIN * 60_000)

  for (let i = liveIdx + 1; i < courtList.length; i += 1) {
    const current = courtList[i]
    if (isMatchFinished(current.match) || isMatchLive(current.match)) {
      continue
    }

    let candidateMs = cursorStartMs
    const hasTimeFloor = current.match.oopTypeId === 1 || current.match.oopTypeId === 2

    if (i > liveIdx + 1) {
      const prevScheduledMs = courtList[i - 1].scheduledInstant.getTime()
      const currScheduledMs = current.scheduledInstant.getTime()
      const rawGapMs = currScheduledMs - prevScheduledMs
      const defaultSlotMs = DEFAULT_MATCH_SLOT_MIN * 60_000
      let slotDurationMs =
        rawGapMs >= 15 * 60_000 && rawGapMs <= 120 * 60_000 ? rawGapMs : defaultSlotMs
      if (hasTimeFloor && slotDurationMs > defaultSlotMs) {
        slotDurationMs = defaultSlotMs
      }
      candidateMs = cursorStartMs + slotDurationMs
    }

    const adjustedMs = hasTimeFloor
      ? Math.max(current.scheduledInstant.getTime(), candidateMs)
      : candidateMs

    cursorStartMs = adjustedMs

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
): MatchTimeView[] {
  const byCourt = new Map<string, MatchTimeView[]>()

  for (const match of matches) {
    const courtName = match.courtName && match.courtName.trim() !== '' ? match.courtName.trim() : 'Court TBC'
    const parts = parseMatchTime(match.matchTime)
    const instant = sourceWallTimeToInstant(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      sourceTimeZone,
    )
    const formattedTime = formatTimeOfDay(instant, localTz)
    const view: MatchTimeView = {
      match,
      matchKey: getMatchKey(match, tournamentCode),
      anchorId: toMatchAnchorId(match),
      courtName,
      courtOrderIndex: 0,
      previousMatchKey: null,
      previousMatch: null,
      sourceInstant: instant,
      scheduledInstant: instant,
      scheduledTimeLabel: formattedTime,
      localInstant: instant,
      timeLabel: formattedTime,
      dateLabel: formatLongDate(instant, localTz),
      isTimeAdjusted: false,
      adjustmentDeltaMinutes: 0,
      liveRemainingMinutes: null,
      oopLabel: convertTimeText(match.oopText || '', sourceTimeZone, contextDate),
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
      }
    }
    adjustCourtTimesForLiveMatch(courtList, localTz, nowMs)
    orderedViews.push(...courtList)
  }

  return orderedViews
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
        location: view.match.locationName || fallbackVenue || '',
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
    const isWalkover = view.match.matchStatus === 'O'
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
