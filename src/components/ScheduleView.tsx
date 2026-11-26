import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { BwfPlayer, BwfTeam, DayMatch } from '../lib/bwf'
import { fetchPlayerProfile, getPlayerProfileUrl } from '../lib/playerProfile'
import { formatLongDate, getBrowserTimeZone } from '../lib/time'
import {
  buildCountryOptions,
  buildOrderedScheduleViews,
  evaluatePinnedMatchNotifications,
  findCourtFocusTarget,
  getPinnedMatchHint,
  groupViewsByCourt,
  isMatchFinished,
  isMatchLive,
  loadAlertSoundEnabled,
  loadPinnedMatchKeys,
  matchHasCountry,
  playerDisplayName,
  playNotificationChime,
  resolveServingTeamForMatch,
  saveAlertSoundEnabled,
  savePinnedMatchKeys,
  toSafeFlagUrl,
} from '../lib/schedule'
import type {
  ActualStartTimesMap,
  MatchStartNotification,
  MatchTimeView,
  ServingTeam,
  ServingTeamsMap,
} from '../lib/schedule'
import { CountryFlag } from './CountryFlag'
import { CourtSidebar } from './CourtSidebar'
import type { CourtSummary, PinnedSidebarItem } from './CourtSidebar'
import { NotificationToasts } from './NotificationToasts'
import { PlayerHovercard } from './PlayerHovercard'
import type { HoveredPlayerTarget } from './PlayerHovercard'

interface InterestDomEvent extends Event {
  source?: Element | null
}

function buildPlayerTarget(
  matchKey: string,
  teamIndex: 1 | 2,
  playerIndex: number,
  player: BwfPlayer,
  partner: BwfPlayer | null,
  eventName: string,
): HoveredPlayerTarget {
  return {
    triggerKey: `${matchKey}:t${teamIndex}:p${playerIndex}`,
    player,
    eventName,
    partnerId: partner?.id?.trim() || null,
    profileUrl: getPlayerProfileUrl(player),
  }
}

interface PlayerTriggerProps {
  target: HoveredPlayerTarget
  name: string
  hovercardId: string
  isActive: boolean
  onTriggerIntent: (target: HoveredPlayerTarget, el: HTMLAnchorElement) => void
  onTriggerLeave: (triggerKey: string) => void
  onTriggerFocus: (target: HoveredPlayerTarget, el: HTMLAnchorElement) => void
  onTriggerBlur: (triggerKey: string) => void
}

function PlayerTrigger({
  target,
  name,
  hovercardId,
  isActive,
  onTriggerIntent,
  onTriggerLeave,
  onTriggerFocus,
  onTriggerBlur,
}: PlayerTriggerProps) {
  if (!target.profileUrl) {
    return <span className="match-team-name">{name}</span>
  }
  return (
    <a
      href={target.profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="match-team-name player-trigger"
      data-player-trigger={target.triggerKey}
      aria-describedby={isActive ? hovercardId : undefined}
      {...({ interestfor: hovercardId } as Record<string, string>)}
      onMouseEnter={(event) => onTriggerIntent(target, event.currentTarget)}
      onMouseLeave={() => onTriggerLeave(target.triggerKey)}
      onFocus={(event) => onTriggerFocus(target, event.currentTarget)}
      onBlur={() => onTriggerBlur(target.triggerKey)}
    >
      {name}
    </a>
  )
}

interface TeamDisplayProps {
  matchKey: string
  teamIndex: 1 | 2
  eventName: string
  team: BwfTeam
  seed: string | null
  isWinner: boolean
  isServing: boolean
  hovercardId: string
  activeTriggerKey: string | null
  onTriggerIntent: (target: HoveredPlayerTarget, el: HTMLAnchorElement) => void
  onTriggerLeave: (triggerKey: string) => void
  onTriggerFocus: (target: HoveredPlayerTarget, el: HTMLAnchorElement) => void
  onTriggerBlur: (triggerKey: string) => void
}

function ServingIndicator() {
  return (
    <span className="serving-indicator" title="Currently serving">
      <svg
        className="serving-indicator-icon"
        viewBox="0 0 16 16"
        width="13"
        height="13"
        aria-hidden="true"
        fill="none"
      >
        <path
          d="M8 13.5c-1.5 0-2.6-1-2.6-2.3 0-.5.2-1 .5-1.4h4.2c.3.4.5.9.5 1.4 0 1.3-1.1 2.3-2.6 2.3Z"
          fill="currentColor"
        />
        <path
          d="M5.8 9.2 3.1 3.5l3.1 1L8 2.5l1.8 2 3.1-1-2.7 5.7"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="serving-indicator-text" aria-hidden="true">
        Srv
      </span>
      <span className="visually-hidden"> (Serving)</span>
    </span>
  )
}

function TeamDisplay({
  matchKey,
  teamIndex,
  eventName,
  team,
  seed,
  isWinner,
  isServing,
  hovercardId,
  activeTriggerKey,
  onTriggerIntent,
  onTriggerLeave,
  onTriggerFocus,
  onTriggerBlur,
}: TeamDisplayProps) {
  const players = (team.players ?? [])
    .map((player) => ({
      player,
      name: playerDisplayName(player),
    }))
    .filter((entry) => entry.name !== '')

  const countryKeys = new Set(
    players
      .map(({ player }) => player.countryCode?.trim() || toSafeFlagUrl(player.countryFlagUrl) || '')
      .filter(Boolean),
  )
  const hasMixedCountries = players.length > 1 && countryKeys.size > 1
  const teamClassName = `match-team${isWinner ? ' winner' : ''}${isServing ? ' is-serving' : ''}`

  if (hasMixedCountries) {
    return (
      <span className={teamClassName}>
        {players.map(({ player, name }, index) => {
          const partner = players.length === 2 ? players[index === 0 ? 1 : 0].player : null
          const target = buildPlayerTarget(matchKey, teamIndex, index, player, partner, eventName)
          return (
            <span className="match-player" key={player.id || `${name}-${index}`}>
              {index > 0 ? (
                <span className="match-player-sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              <CountryFlag
                flagUrl={player.countryFlagUrl}
                countryCode={player.countryCode}
                countryName={player.countryName}
              />
              <PlayerTrigger
                target={target}
                name={name}
                hovercardId={hovercardId}
                isActive={activeTriggerKey === target.triggerKey}
                onTriggerIntent={onTriggerIntent}
                onTriggerLeave={onTriggerLeave}
                onTriggerFocus={onTriggerFocus}
                onTriggerBlur={onTriggerBlur}
              />
            </span>
          )
        })}
        {seed ? <span className="match-seed">({seed})</span> : null}
        {isServing ? <ServingIndicator /> : null}
      </span>
    )
  }

  const sharedFlagUrl =
    toSafeFlagUrl(team.countryFlagUrl) ??
    players.map(({ player }) => toSafeFlagUrl(player.countryFlagUrl)).find(Boolean) ??
    null
  const sharedCountryCode =
    team.countryCode?.trim() || players.find(({ player }) => player.countryCode)?.player.countryCode || ''
  const sharedCountryName =
    players.find(({ player }) => player.countryName)?.player.countryName || sharedCountryCode

  if (players.length === 0) {
    return (
      <span className={teamClassName}>
        <CountryFlag flagUrl={sharedFlagUrl} countryCode={sharedCountryCode} countryName={sharedCountryName} />
        <span className="match-team-name">{team.teamName?.trim() || 'TBD'}</span>
        {seed ? <span className="match-seed">({seed})</span> : null}
        {isServing ? <ServingIndicator /> : null}
      </span>
    )
  }

  return (
    <span className={teamClassName}>
      <CountryFlag flagUrl={sharedFlagUrl} countryCode={sharedCountryCode} countryName={sharedCountryName} />
      {players.map(({ player, name }, index) => {
        const partner = players.length === 2 ? players[index === 0 ? 1 : 0].player : null
        const target = buildPlayerTarget(matchKey, teamIndex, index, player, partner, eventName)
        return (
          <span className="match-player" key={player.id || `${name}-${index}`}>
            {index > 0 ? (
              <span className="match-player-sep" aria-hidden="true">
                /
              </span>
            ) : null}
            <PlayerTrigger
              target={target}
              name={name}
              hovercardId={hovercardId}
              isActive={activeTriggerKey === target.triggerKey}
              onTriggerIntent={onTriggerIntent}
              onTriggerLeave={onTriggerLeave}
              onTriggerFocus={onTriggerFocus}
              onTriggerBlur={onTriggerBlur}
            />
          </span>
        )
      })}
      {seed ? <span className="match-seed">({seed})</span> : null}
      {isServing ? <ServingIndicator /> : null}
    </span>
  )
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="pin-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 2.5h5l-.8 3.6 2.1 2.1v1.3H8.7v3.5L8 14.5l-.7-1.5V9.5H4.2V8.2l2.1-2.1-.8-3.6Z" />
    </svg>
  )
}

function renderScore(match: DayMatch, view: MatchTimeView, servingTeam: ServingTeam | null): ReactNode {
  const score = match.score ?? []
  const hasScore = score.length > 0
  const hasDuration = view.durationLabel !== null && view.durationIso !== null
  if (!hasScore && !hasDuration) {
    return null
  }
  const live = isMatchLive(match)
  const durationAccessibleLabel = `Match duration: ${view.durationLongLabel ?? view.durationLabel}`
  return (
    <div className={`match-score${live ? ' is-live' : ''}`}>
      {score.map((set, index) => {
        const homePoints = set.home ?? 0
        const awayPoints = set.away ?? 0
        const homeWon = (match.winner === 1 || (!live && homePoints > awayPoints)) && homePoints > awayPoints
        const awayWon = (match.winner === 2 || (!live && awayPoints > homePoints)) && awayPoints > homePoints
        const isActiveSet = live && !isMatchFinished(match) && index === score.length - 1
        const homeServing = isActiveSet && servingTeam === 1
        const awayServing = isActiveSet && servingTeam === 2
        return (
          <span key={index} className={`match-set${isActiveSet ? ' is-active-set' : ''}`}>
            {homeServing ? <span className="set-serve-dot" aria-hidden="true" title="Team 1 serving" /> : null}
            <span className={homeWon ? 'set-won' : homeServing ? 'set-serving' : undefined}>{homePoints}</span>
            <span className="match-set-separator">-</span>
            <span className={awayWon ? 'set-won' : awayServing ? 'set-serving' : undefined}>{awayPoints}</span>
            {awayServing ? <span className="set-serve-dot" aria-hidden="true" title="Team 2 serving" /> : null}
          </span>
        )
      })}
      {hasDuration && view.durationIso ? (
        <time
          className="match-duration"
          dateTime={view.durationIso}
          title={durationAccessibleLabel}
          aria-label={durationAccessibleLabel}
        >
          <svg
            className="match-duration-icon"
            viewBox="0 0 16 16"
            width="13"
            height="13"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 4.75V8l2.25 1.5" />
          </svg>
          <span>{view.durationLabel}</span>
        </time>
      ) : null}
    </div>
  )
}

function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return window.Notification.permission
}

function scrollIntoViewAsync(element: HTMLElement, options: ScrollIntoViewOptions): Promise<void> {
  const result = (element.scrollIntoView as (arg?: boolean | ScrollIntoViewOptions) => unknown)(options)
  if (result instanceof Promise) {
    return result as Promise<void>
  }
  if (options.behavior !== 'smooth' || typeof window === 'undefined') {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    let timeoutId = 0
    const finish = () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('scrollend', finish)
      window.removeEventListener('scroll', onScroll)
      resolve()
    }
    const onScroll = () => {
      window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(finish, 120)
    }
    window.addEventListener('scrollend', finish, { once: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    timeoutId = window.setTimeout(finish, 120)
  })
}

interface ScheduleViewProps {
  tournamentCode: string
  tournamentName: string
  venue: string
  contextDate: string
  sourceTimeZone: string
  matches: DayMatch[]
  onlyInProgress: boolean
  onOnlyInProgressChange: (next: boolean) => void
  selectedCountry: string
  onSelectedCountryChange: (countryCode: string) => void
  loading: boolean
  onRefreshNow: () => void
  autoRefresh: boolean
  onAutoRefreshChange: (enabled: boolean) => void
  autoRefreshIntervalSec: number
  onAutoRefreshIntervalChange: (seconds: number) => void
  secondsUntilRefresh: number | null
  onEnableAutoRefresh: () => void
  actualStartTimes: Readonly<ActualStartTimesMap>
  servingTeams?: Readonly<ServingTeamsMap>
  fetchedAtMs?: number
}

export function ScheduleView({
  tournamentCode,
  tournamentName,
  venue,
  contextDate,
  sourceTimeZone,
  matches,
  onlyInProgress,
  onOnlyInProgressChange,
  selectedCountry,
  onSelectedCountryChange,
  loading,
  onRefreshNow,
  autoRefresh,
  onAutoRefreshChange,
  autoRefreshIntervalSec,
  onAutoRefreshIntervalChange,
  secondsUntilRefresh,
  onEnableAutoRefresh,
  actualStartTimes,
  servingTeams = {},
  fetchedAtMs = 0,
}: ScheduleViewProps) {
  const localTz = getBrowserTimeZone()
  const scheduleScopeKey = `${tournamentCode}:${contextDate}`

  const [pinnedKeyList, setPinnedKeyList] = useState<string[]>(() => loadPinnedMatchKeys())
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadAlertSoundEnabled())
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getBrowserNotificationPermission(),
  )
  const [toasts, setToasts] = useState<MatchStartNotification[]>([])
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [recalcTick, setRecalcTick] = useState(0)

  const pinnedKeys = useMemo(() => new Set(pinnedKeyList), [pinnedKeyList])
  const pendingJumpAnchorRef = useRef<string | null>(null)
  const notifiedKeysRef = useRef<Set<string>>(new Set())
  const previousFinishedByKeyRef = useRef<Map<string, boolean>>(new Map())
  const previousStatusByKeyRef = useRef<Map<string, string>>(new Map())
  const lastScopeKeyRef = useRef<string>(scheduleScopeKey)

  const effectiveNowMs = Math.max(nowMs, fetchedAtMs)

  const allViews = useMemo(() => {
    void recalcTick
    void onlyInProgress
    void selectedCountry
    return buildOrderedScheduleViews(
      matches,
      sourceTimeZone,
      contextDate,
      localTz,
      tournamentCode,
      effectiveNowMs,
      actualStartTimes,
    )
  }, [
    matches,
    sourceTimeZone,
    contextDate,
    localTz,
    tournamentCode,
    effectiveNowMs,
    actualStartTimes,
    recalcTick,
    onlyInProgress,
    selectedCountry,
  ])

  const countries = useMemo(() => buildCountryOptions(matches), [matches])

  const totalLiveCount = useMemo(
    () => allViews.reduce((acc, view) => acc + (isMatchLive(view.match) ? 1 : 0), 0),
    [allViews],
  )

  const hasLiveMatches = useMemo(() => matches.some((m) => isMatchLive(m)), [matches])

  const visibleViews = useMemo(
    () =>
      allViews.filter((view) => {
        if (onlyInProgress && !isMatchLive(view.match)) {
          return false
        }
        if (selectedCountry && !matchHasCountry(view.countryCodes, selectedCountry)) {
          return false
        }
        return true
      }),
    [allViews, onlyInProgress, selectedCountry],
  )

  const visibleMatchKeySet = useMemo(() => new Set(visibleViews.map((v) => v.matchKey)), [visibleViews])

  const courts = useMemo(() => groupViewsByCourt(visibleViews, venue), [visibleViews, venue])

  const courtSummaries = useMemo<CourtSummary[]>(
    () =>
      courts.map((court) => ({
        id: court.id,
        name: court.name,
        location: court.location,
        matchCount: court.matches.length,
        liveCount: court.liveCount,
        focusTarget: findCourtFocusTarget(court.matches),
      })),
    [courts],
  )

  const pinnedSidebarItems = useMemo<PinnedSidebarItem[]>(() => {
    const items: PinnedSidebarItem[] = []
    for (const view of allViews) {
      if (!pinnedKeys.has(view.matchKey)) {
        continue
      }
      items.push({
        matchKey: view.matchKey,
        anchorId: view.anchorId,
        courtName: view.courtName,
        summary: view.summary,
        hint: getPinnedMatchHint(view, effectiveNowMs),
        isVisible: visibleMatchKeySet.has(view.matchKey),
      })
    }
    return items
  }, [allViews, pinnedKeys, effectiveNowMs, visibleMatchKeySet])

  const hasPinnedInCurrentSchedule = pinnedSidebarItems.length > 0
  const shouldTickClock = hasPinnedInCurrentSchedule || hasLiveMatches

  useEffect(() => {
    if (!shouldTickClock) {
      return
    }
    const timerId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 15_000)
    return () => window.clearInterval(timerId)
  }, [shouldTickClock])

  const hovercardId = useId()
  const hovercardRef = useRef<HTMLDivElement | null>(null)
  const [hoveredTarget, setHoveredTarget] = useState<HoveredPlayerTarget | null>(null)
  const [fallbackPosition, setFallbackPosition] = useState<{ top: number; left: number } | null>(null)
  const hoveredTargetRef = useRef<HoveredPlayerTarget | null>(null)
  const targetsByKeyRef = useRef<Map<string, HoveredPlayerTarget>>(new Map())
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const prefetchTimerRef = useRef<number | null>(null)

  const supportsInterestFor =
    typeof HTMLAnchorElement !== 'undefined' && 'interestForElement' in HTMLAnchorElement.prototype
  const supportsAnchorPos =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('position-area: block-end')

  useEffect(() => {
    hoveredTargetRef.current = hoveredTarget
  }, [hoveredTarget])

  const playerTargetsMap = useMemo(() => {
    const map = new Map<string, HoveredPlayerTarget>()
    for (const view of visibleViews) {
      const registerTeam = (team: BwfTeam, teamIndex: 1 | 2) => {
        const players = (team.players ?? []).filter((p) => playerDisplayName(p) !== '')
        players.forEach((player, index) => {
          const partner = players.length === 2 ? players[index === 0 ? 1 : 0] : null
          const target = buildPlayerTarget(
            view.matchKey,
            teamIndex,
            index,
            player,
            partner,
            view.match.eventName,
          )
          map.set(target.triggerKey, target)
        })
      }
      registerTeam(view.match.team1, 1)
      registerTeam(view.match.team2, 2)
    }
    return map
  }, [visibleViews])

  useEffect(() => {
    targetsByKeyRef.current = playerTargetsMap
  }, [playerTargetsMap])

  const clearHoverTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (prefetchTimerRef.current !== null) {
      window.clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
  }, [])

  const hideFallbackPopover = useCallback(() => {
    const card = hovercardRef.current
    setHoveredTarget(null)
    setFallbackPosition(null)
    if (!card) {
      return
    }
    const supportsPopover =
      typeof HTMLElement !== 'undefined' &&
      Object.hasOwn(HTMLElement.prototype, 'popover') &&
      typeof card.hidePopover === 'function'
    if (supportsPopover) {
      if (card.matches(':popover-open')) {
        try {
          card.hidePopover()
        } catch {
          // Ignore if already closed.
        }
      }
    }
    card.classList.remove(':popover-open')
  }, [])

  const showFallbackPopover = useCallback(
    (target: HoveredPlayerTarget, triggerEl: HTMLAnchorElement) => {
      const card = hovercardRef.current
      if (!card) {
        return
      }
      setHoveredTarget(target)

      if (!supportsAnchorPos) {
        const rect = triggerEl.getBoundingClientRect()
        const cardWidth = 310
        const margin = 12
        const maxLeft = Math.max(margin, window.innerWidth - cardWidth - margin)
        const left = Math.min(Math.max(margin, rect.left), maxLeft)
        const preferBelow = rect.bottom + 240 <= window.innerHeight || rect.top < 240
        const top = preferBelow ? rect.bottom + 8 : Math.max(margin, rect.top - 220)
        setFallbackPosition({ top, left })
      } else {
        setFallbackPosition(null)
      }

      const supportsPopover =
        typeof HTMLElement !== 'undefined' &&
        Object.hasOwn(HTMLElement.prototype, 'popover') &&
        typeof card.showPopover === 'function'
      if (supportsPopover) {
        try {
          ;(card as HTMLElement & { showPopover: (opts?: { source?: HTMLElement }) => void }).showPopover({
            source: triggerEl,
          })
        } catch {
          try {
            card.showPopover()
          } catch {
            card.classList.add(':popover-open')
          }
        }
      } else {
        card.classList.add(':popover-open')
      }
    },
    [supportsAnchorPos],
  )

  useEffect(() => {
    const card = hovercardRef.current
    if (!card) {
      return
    }

    const handleInterest = (event: Event) => {
      const source = (event as InterestDomEvent).source
      const key = source instanceof HTMLElement ? source.dataset.playerTrigger : undefined
      if (!key) {
        return
      }
      const target = targetsByKeyRef.current.get(key) ?? null
      setHoveredTarget(target)
    }

    const handleToggle = (event: Event) => {
      const toggleEvent = event as ToggleEvent
      if (toggleEvent.newState === 'closed') {
        setHoveredTarget(null)
        setFallbackPosition(null)
      }
    }

    card.addEventListener('interest', handleInterest)
    card.addEventListener('toggle', handleToggle)
    return () => {
      card.removeEventListener('interest', handleInterest)
      card.removeEventListener('toggle', handleToggle)
    }
  }, [])

  useEffect(() => {
    if (supportsInterestFor) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && hoveredTargetRef.current) {
        clearHoverTimers()
        hideFallbackPopover()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [supportsInterestFor, clearHoverTimers, hideFallbackPopover])

  useEffect(() => () => clearHoverTimers(), [clearHoverTimers])

  const handleTriggerIntent = useCallback(
    (target: HoveredPlayerTarget, el: HTMLAnchorElement) => {
      if (prefetchTimerRef.current !== null) {
        window.clearTimeout(prefetchTimerRef.current)
      }
      prefetchTimerRef.current = window.setTimeout(() => {
        prefetchTimerRef.current = null
        void fetchPlayerProfile(target.player, target.eventName, target.partnerId)
      }, 80)

      if (supportsInterestFor) {
        return
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current)
      }
      const delay = hoveredTargetRef.current ? 0 : 180
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null
        showFallbackPopover(target, el)
      }, delay)
    },
    [supportsInterestFor, showFallbackPopover],
  )

  const handleTriggerFocus = useCallback(
    (target: HoveredPlayerTarget, el: HTMLAnchorElement) => {
      void fetchPlayerProfile(target.player, target.eventName, target.partnerId)
      if (supportsInterestFor) {
        return
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current)
        openTimerRef.current = null
      }
      showFallbackPopover(target, el)
    },
    [supportsInterestFor, showFallbackPopover],
  )

  const handleTriggerLeave = useCallback(
    (triggerKey: string) => {
      if (prefetchTimerRef.current !== null) {
        window.clearTimeout(prefetchTimerRef.current)
        prefetchTimerRef.current = null
      }
      if (supportsInterestFor) {
        return
      }
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current)
        openTimerRef.current = null
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        if (hoveredTargetRef.current?.triggerKey === triggerKey) {
          hideFallbackPopover()
        }
      }, 140)
    },
    [supportsInterestFor, hideFallbackPopover],
  )

  const handleHovercardMouseEnter = useCallback(() => {
    if (supportsInterestFor) {
      return
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [supportsInterestFor])

  const handleHovercardMouseLeave = useCallback(() => {
    if (supportsInterestFor) {
      return
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      hideFallbackPopover()
    }, 140)
  }, [supportsInterestFor, hideFallbackPopover])

  const dispatchStartNotifications = useCallback(
    (incoming: MatchStartNotification[]) => {
      if (incoming.length === 0) {
        return
      }
      for (const item of incoming) {
        notifiedKeysRef.current.add(item.matchKey)
      }
      setToasts((current) => [...current, ...incoming])

      if (soundEnabled) {
        playNotificationChime()
      }

      if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
        for (const item of incoming) {
          try {
            const browserNotification = new window.Notification(item.title, {
              body: item.body,
              tag: item.matchKey,
            })
            browserNotification.onclick = () => {
              window.focus()
              browserNotification.close()
            }
          } catch {
            // Browser notifications may fail in restricted contexts; in-app toast remains active.
          }
        }
      }
    },
    [soundEnabled],
  )

  useEffect(() => {
    if (lastScopeKeyRef.current !== scheduleScopeKey) {
      lastScopeKeyRef.current = scheduleScopeKey
      previousFinishedByKeyRef.current = new Map()
      previousStatusByKeyRef.current = new Map()
    }

    const incoming = evaluatePinnedMatchNotifications({
      allViews,
      pinnedKeys,
      notifiedKeys: notifiedKeysRef.current,
      previousFinishedByKey: previousFinishedByKeyRef.current,
      previousStatusByKey: previousStatusByKeyRef.current,
      nowMs: effectiveNowMs,
    })

    if (incoming.length > 0) {
      dispatchStartNotifications(incoming)
    }

    const nextFinished = new Map<string, boolean>()
    const nextStatus = new Map<string, string>()
    for (const view of allViews) {
      nextFinished.set(view.matchKey, isMatchFinished(view.match))
      nextStatus.set(view.matchKey, view.match.matchStatus)
    }
    previousFinishedByKeyRef.current = nextFinished
    previousStatusByKeyRef.current = nextStatus
  }, [allViews, pinnedKeys, effectiveNowMs, scheduleScopeKey, dispatchStartNotifications])

  const handleRequestNotificationPermission = useCallback(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }
    void window.Notification.requestPermission()
      .then((result) => {
        setNotificationPermission(result)
      })
      .catch(() => {
        setNotificationPermission(getBrowserNotificationPermission())
      })
  }, [])

  const handleTogglePin = useCallback((matchKey: string) => {
    setNowMs(Date.now())
    setPinnedKeyList((current) => {
      const exists = current.includes(matchKey)
      const next = exists ? current.filter((key) => key !== matchKey) : [...current, matchKey]
      if (exists) {
        notifiedKeysRef.current.delete(matchKey)
        setToasts((activeToasts) => activeToasts.filter((toast) => toast.matchKey !== matchKey))
      }
      savePinnedMatchKeys(next)
      return next
    })
  }, [])

  const handleToggleSound = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled)
    saveAlertSoundEnabled(enabled)
  }, [])

  const handleDismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const handleDismissAllToasts = useCallback(() => {
    setToasts([])
  }, [])

  const handleOnlyInProgressChange = useCallback(
    (next: boolean) => {
      setNowMs(Date.now())
      setRecalcTick((tick) => tick + 1)
      onOnlyInProgressChange(next)
    },
    [onOnlyInProgressChange],
  )

  const handleSelectedCountryChange = useCallback(
    (countryCode: string) => {
      setNowMs(Date.now())
      setRecalcTick((tick) => tick + 1)
      onSelectedCountryChange(countryCode)
    },
    [onSelectedCountryChange],
  )

  const handleResetFilters = useCallback(() => {
    setNowMs(Date.now())
    setRecalcTick((tick) => tick + 1)
    onOnlyInProgressChange(false)
    onSelectedCountryChange('')
  }, [onOnlyInProgressChange, onSelectedCountryChange])

  const [focusedMatchAnchorId, setFocusedMatchAnchorId] = useState<string | null>(null)
  const scrollRequestIdRef = useRef(0)
  const focusHighlightTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (focusHighlightTimerRef.current !== null) {
        window.clearTimeout(focusHighlightTimerRef.current)
      }
    },
    [],
  )

  const scrollAndFocusElement = useCallback(
    async (scrollTargetId: string, focusTargetId: string, block: ScrollLogicalPosition) => {
      const scrollTarget = document.getElementById(scrollTargetId)
      const focusTarget = document.getElementById(focusTargetId)
      if (!scrollTarget || !focusTarget) {
        return
      }
      const scrollId = ++scrollRequestIdRef.current
      if (focusHighlightTimerRef.current !== null) {
        window.clearTimeout(focusHighlightTimerRef.current)
        focusHighlightTimerRef.current = null
      }
      setFocusedMatchAnchorId(null)

      const prefersReducedMotion =
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      await scrollIntoViewAsync(scrollTarget, {
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block,
      })

      if (scrollId !== scrollRequestIdRef.current || !focusTarget.isConnected) {
        return
      }

      focusTarget.focus({ preventScroll: true })
      if (focusTarget.classList.contains('match-row')) {
        setFocusedMatchAnchorId(focusTargetId)
        focusHighlightTimerRef.current = window.setTimeout(() => {
          focusHighlightTimerRef.current = null
          setFocusedMatchAnchorId((current) => (current === focusTargetId ? null : current))
        }, 2200)
      }
    },
    [],
  )

  const scrollToAnchor = useCallback(
    (anchorId: string) => {
      void scrollAndFocusElement(anchorId, anchorId, 'center')
    },
    [scrollAndFocusElement],
  )

  const handleJumpToMatch = useCallback(
    (anchorId: string, clearFiltersIfHidden = false) => {
      if (clearFiltersIfHidden) {
        pendingJumpAnchorRef.current = anchorId
        handleResetFilters()
        return
      }
      const el = document.getElementById(anchorId)
      if (el) {
        scrollToAnchor(anchorId)
      } else {
        pendingJumpAnchorRef.current = anchorId
        handleResetFilters()
      }
    },
    [handleResetFilters, scrollToAnchor],
  )

  useEffect(() => {
    const anchorId = pendingJumpAnchorRef.current
    if (!anchorId) {
      return
    }
    const target = document.getElementById(anchorId)
    if (target) {
      pendingJumpAnchorRef.current = null
      scrollToAnchor(anchorId)
    }
  }, [courts, scrollToAnchor])

  const [activeCourtId, setActiveCourtId] = useState<string | null>(null)
  const [hasNativeTarget, setHasNativeTarget] = useState(false)
  const navRef = useRef<HTMLElement | null>(null)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const supportsScrollTargetGroup =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('scroll-target-group: auto')

  const effectiveActiveCourtId =
    activeCourtId && courts.some((court) => court.id === activeCourtId)
      ? activeCourtId
      : (courts[0]?.id ?? null)

  const handleSelectCourt = useCallback(
    (courtId: string, event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return
      }
      event.preventDefault()
      setActiveCourtId(courtId)
      const court = courtSummaries.find((entry) => entry.id === courtId)
      if (court?.focusTarget) {
        const scrollTargetId = court.focusTarget.isFirstVisibleMatch ? court.id : court.focusTarget.anchorId
        const scrollBlock: ScrollLogicalPosition =
          !court.focusTarget.isFirstVisibleMatch && court.focusTarget.remainingMatchesAfter <= 1
            ? 'center'
            : 'start'
        void scrollAndFocusElement(scrollTargetId, court.focusTarget.anchorId, scrollBlock)
        return
      }
      void scrollAndFocusElement(courtId, courtId, 'start')
    },
    [courtSummaries, scrollAndFocusElement],
  )

  useEffect(() => {
    if (courts.length === 0) {
      return
    }

    const updateActiveFromViewport = () => {
      if (supportsScrollTargetGroup) {
        const currentLink = navRef.current?.querySelector<HTMLAnchorElement>('a:target-current')
        const targetId = currentLink?.dataset.courtId ?? null
        setHasNativeTarget(Boolean(targetId))
        if (targetId) {
          setActiveCourtId(targetId)
          return
        }
      } else {
        setHasNativeTarget(false)
      }

      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atBottom) {
        const lastCourt = courts[courts.length - 1]
        const lastEl = lastCourt ? sectionRefs.current.get(lastCourt.id) : null
        if (lastCourt && lastEl && lastEl.getBoundingClientRect().top < window.innerHeight) {
          setActiveCourtId(lastCourt.id)
          return
        }
      }

      const anchorY = Math.min(window.innerHeight * 0.3, 220)
      let currentId: string | null = courts[0]?.id ?? null
      for (const court of courts) {
        const el = sectionRefs.current.get(court.id)
        if (!el) {
          continue
        }
        const rect = el.getBoundingClientRect()
        if (rect.top <= anchorY && rect.bottom > 40) {
          currentId = court.id
        }
      }
      if (currentId) {
        setActiveCourtId(currentId)
      }
    }

    let timeoutId = 0
    const schedulePostPaintSync = () => {
      if (timeoutId !== 0) {
        window.clearTimeout(timeoutId)
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = 0
        updateActiveFromViewport()
      }, 32)
    }

    const observer = new IntersectionObserver(
      () => {
        schedulePostPaintSync()
      },
      {
        rootMargin: '-18% 0px -65% 0px',
        threshold: [0, 0.25, 0.5, 1],
      },
    )

    for (const court of courts) {
      const el = sectionRefs.current.get(court.id)
      if (el) {
        observer.observe(el)
      }
    }

    schedulePostPaintSync()
    window.addEventListener('scroll', schedulePostPaintSync, { passive: true })
    document.addEventListener('scrollend', schedulePostPaintSync)
    return () => {
      if (timeoutId !== 0) {
        window.clearTimeout(timeoutId)
      }
      observer.disconnect()
      window.removeEventListener('scroll', schedulePostPaintSync)
      document.removeEventListener('scrollend', schedulePostPaintSync)
    }
  }, [courts, supportsScrollTargetGroup])

  useEffect(() => {
    if (!effectiveActiveCourtId || !navRef.current) {
      return
    }
    const navEl = navRef.current
    if (navEl.scrollWidth <= navEl.clientWidth) {
      return
    }
    const links = Array.from(navEl.querySelectorAll<HTMLAnchorElement>('a[data-court-id]'))
    const activeLink = links.find((link) => link.dataset.courtId === effectiveActiveCourtId)
    if (!activeLink) {
      return
    }
    const targetLeft = activeLink.offsetLeft - (navEl.clientWidth - activeLink.clientWidth) / 2
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    navEl.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }, [effectiveActiveCourtId])

  const hasActiveFilters = onlyInProgress || selectedCountry !== ''
  const selectedCountryOption = countries.find((c) => c.code === selectedCountry)
  const firstDateLabel =
    visibleViews.length > 0
      ? visibleViews[0].dateLabel
      : allViews.length > 0
        ? allViews[0].dateLabel
        : formatLongDate(new Date(effectiveNowMs), localTz)

  const emptyMessage = useMemo(() => {
    if (allViews.length === 0) {
      return 'No matches scheduled for this date.'
    }
    if (onlyInProgress && selectedCountryOption) {
      return `No matches for ${selectedCountryOption.name} (${selectedCountryOption.code}) are currently in progress.`
    }
    if (onlyInProgress) {
      return 'No matches are currently in progress.'
    }
    if (selectedCountryOption) {
      return `No matches found for ${selectedCountryOption.name} (${selectedCountryOption.code}).`
    }
    return 'No matches match the active filters.'
  }, [allViews.length, onlyInProgress, selectedCountryOption])

  return (
    <div className="schedule schedule--with-sidebar">
      <CourtSidebar
        courts={courtSummaries}
        totalMatchCount={allViews.length}
        totalLiveCount={totalLiveCount}
        activeCourtId={effectiveActiveCourtId}
        useNativeTargetCurrent={supportsScrollTargetGroup && hasNativeTarget}
        navRef={navRef}
        onSelectCourt={handleSelectCourt}
        onlyInProgress={onlyInProgress}
        onOnlyInProgressChange={handleOnlyInProgressChange}
        countries={countries}
        selectedCountry={selectedCountry}
        onSelectedCountryChange={handleSelectedCountryChange}
        pinnedMatches={pinnedSidebarItems}
        onUnpinMatch={handleTogglePin}
        onJumpToMatch={handleJumpToMatch}
        notificationPermission={notificationPermission}
        onRequestNotificationPermission={handleRequestNotificationPermission}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        loading={loading}
        onRefreshNow={onRefreshNow}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={onAutoRefreshChange}
        autoRefreshIntervalSec={autoRefreshIntervalSec}
        onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
        secondsUntilRefresh={secondsUntilRefresh}
        onEnableAutoRefresh={onEnableAutoRefresh}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
      />

      <div className="schedule-main">
        <div className="schedule-header">
          <div className="schedule-header-top">
            <div>
              <h2>{tournamentName}</h2>
              {venue ? <p className="schedule-venue">{venue}</p> : null}
              <p className="schedule-date">{firstDateLabel}</p>
            </div>

            {allViews.length > 0 ? (
              <div className="schedule-summary-pills">
                {totalLiveCount > 0 ? (
                  <span className="summary-pill is-live">
                    <span className="court-live-dot" aria-hidden="true" />
                    {totalLiveCount} live
                  </span>
                ) : null}
                <span className="summary-pill">
                  {hasActiveFilters
                    ? `${visibleViews.length} of ${allViews.length} matches`
                    : `${allViews.length} ${allViews.length === 1 ? 'match' : 'matches'}`}
                </span>
                {pinnedSidebarItems.length > 0 ? (
                  <span className="summary-pill is-pinned">{pinnedSidebarItems.length} pinned</span>
                ) : null}
              </div>
            ) : null}
          </div>

          <p className="schedule-timezone-note">
            Times below are converted from <strong>{sourceTimeZone}</strong> to your local time (<strong>{localTz}</strong>).
          </p>
        </div>

        {courts.length === 0 ? (
          <div className="status-box empty-state-box">
            <p>{emptyMessage}</p>
            {hasActiveFilters ? (
              <button type="button" className="btn btn-secondary" onClick={handleResetFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          courts.map((court) => (
            <section
              className={`court-block${court.liveCount > 0 ? ' has-live' : ''}`}
              key={court.id}
              id={court.id}
              tabIndex={-1}
              ref={(node) => {
                if (node) {
                  sectionRefs.current.set(court.id, node)
                } else {
                  sectionRefs.current.delete(court.id)
                }
              }}
            >
              <div className="court-heading-row">
                <h3 className="court-name">
                  {court.name}
                  {court.location ? <span className="court-location"> — {court.location}</span> : null}
                </h3>
                <div className="court-heading-meta">
                  {court.liveCount > 0 ? (
                    <span className="court-heading-live">
                      <span className="court-live-dot" aria-hidden="true" />
                      {court.liveCount} live
                    </span>
                  ) : null}
                  <span className="court-heading-count">
                    {court.matches.length} {court.matches.length === 1 ? 'match' : 'matches'}
                  </span>
                </div>
              </div>

              <div className="match-list">
                {court.matches.map((view) => {
                  const { match } = view
                  const isPinned = pinnedKeys.has(view.matchKey)
                  const pinHint = isPinned ? getPinnedMatchHint(view, effectiveNowMs) : null
                  const isLive = view.statusTone === 'live'
                  const servingTeam: ServingTeam | null = isLive
                    ? (servingTeams[view.matchKey] ?? resolveServingTeamForMatch(match).servingTeam)
                    : null
                  return (
                    <article
                      id={view.anchorId}
                      tabIndex={-1}
                      className={`match-row status-${view.statusTone}${match.winner !== 0 ? ' has-winner' : ''}${isPinned ? ' is-pinned' : ''}${focusedMatchAnchorId === view.anchorId ? ' is-focused-target' : ''}`}
                      key={view.matchKey}
                    >
                      <div className="match-time">
                        {isLive ? (
                          <span className="match-live-kicker" aria-hidden="true">
                            <span className="status-live-dot" />
                            LIVE
                          </span>
                        ) : null}
                        <span className="match-time-value">{view.timeLabel}</span>
                        {view.isActualStartTime ? (
                          <span
                            className="match-time-actual"
                            title={
                              view.actualStartTimeLabel !== view.scheduledTimeLabel
                                ? `Actual start time captured when match began (scheduled: ${view.scheduledTimeLabel})`
                                : 'Actual start time captured when match began'
                            }
                          >
                            {view.actualStartTimeLabel !== view.scheduledTimeLabel
                              ? `Actual · sched. ${view.scheduledTimeLabel}`
                              : 'Actual start'}
                          </span>
                        ) : view.isCalculatedStartTime ? (
                          <span
                            className="match-time-adjusted"
                            title={
                              view.timeLabel !== view.scheduledTimeLabel
                                ? `Calculated from previous match + duration + 8m gap (scheduled: ${view.scheduledTimeLabel})`
                                : 'Calculated from previous match + duration + 8m gap'
                            }
                          >
                            {view.timeLabel !== view.scheduledTimeLabel
                              ? `Calc. · sched. ${view.scheduledTimeLabel}`
                              : 'Calc. start'}
                          </span>
                        ) : view.isTimeAdjusted ? (
                          <span
                            className="match-time-adjusted"
                            title={`Estimated from the current in-progress match (original schedule: ${view.scheduledTimeLabel})`}
                          >
                            Est. · was {view.scheduledTimeLabel}
                          </span>
                        ) : null}
                        {view.liveRemainingMinutes !== null ? (
                          <span className="match-live-eta">~{view.liveRemainingMinutes}m left</span>
                        ) : null}
                        <span className="match-time-date">{view.dateLabel}</span>
                        <span className="match-order-badge">Match #{view.courtOrderIndex + 1}</span>
                      </div>

                      <div className="match-main">
                        <div className="match-title">
                          <span className="match-event">{match.eventName}</span>
                          <span className="match-type">{match.matchTypeValue}</span>
                          {match.matchTypeNo ? <span className="match-type-no">{match.matchTypeNo}</span> : null}
                          <span className="match-round">Round {match.roundName}</span>
                          {pinHint ? (
                            <span className={`match-pin-status tone-${pinHint.tone}`}>
                              Pinned · {pinHint.label}
                            </span>
                          ) : null}
                        </div>

                        <div className="match-players">
                          <TeamDisplay
                            matchKey={view.matchKey}
                            teamIndex={1}
                            eventName={match.eventName}
                            team={match.team1}
                            seed={match.team1seed}
                            isWinner={match.winner === 1}
                            isServing={servingTeam === 1}
                            hovercardId={hovercardId}
                            activeTriggerKey={hoveredTarget?.triggerKey ?? null}
                            onTriggerIntent={handleTriggerIntent}
                            onTriggerLeave={handleTriggerLeave}
                            onTriggerFocus={handleTriggerFocus}
                            onTriggerBlur={handleTriggerLeave}
                          />
                          <span className="match-vs">vs</span>
                          <TeamDisplay
                            matchKey={view.matchKey}
                            teamIndex={2}
                            eventName={match.eventName}
                            team={match.team2}
                            seed={match.team2seed}
                            isWinner={match.winner === 2}
                            isServing={servingTeam === 2}
                            hovercardId={hovercardId}
                            activeTriggerKey={hoveredTarget?.triggerKey ?? null}
                            onTriggerIntent={handleTriggerIntent}
                            onTriggerLeave={handleTriggerLeave}
                            onTriggerFocus={handleTriggerFocus}
                            onTriggerBlur={handleTriggerLeave}
                          />
                        </div>

                        {renderScore(match, view, servingTeam)}
                        {view.oopLabel ? <div className="match-schedule">{view.oopLabel}</div> : null}
                      </div>

                      <div className="match-actions">
                        <span className={`match-status tone-${view.statusTone}`}>
                          {view.statusTone === 'live' ? <span className="status-live-dot" aria-hidden="true" /> : null}
                          {view.statusLabel}
                        </span>
                        <button
                          type="button"
                          className={`match-pin-btn${isPinned ? ' is-pinned' : ''}`}
                          aria-pressed={isPinned}
                          onClick={() => handleTogglePin(view.matchKey)}
                        >
                          <PinIcon filled={isPinned} />
                          <span>Pin</span>
                          <span className="visually-hidden"> {view.summary}</span>
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <NotificationToasts
        toasts={toasts}
        onDismiss={handleDismissToast}
        onDismissAll={handleDismissAllToasts}
        onJumpToMatch={(anchorId) => handleJumpToMatch(anchorId, false)}
      />

      <PlayerHovercard
        hovercardId={hovercardId}
        hovercardRef={hovercardRef}
        target={hoveredTarget}
        fallbackPosition={fallbackPosition}
        onMouseEnterCard={handleHovercardMouseEnter}
        onMouseLeaveCard={handleHovercardMouseLeave}
      />
    </div>
  )
}
