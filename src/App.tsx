import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { DayMatch, BwfTournament, CalendarTournament } from './lib/bwf'
import {
  applyDateToUrl,
  buildTournamentResultsUrl,
  extractTournamentIdFromUrl,
  extractTrailingIsoDate,
  fetchBwfTournamentById,
  fetchBwfTournamentDetails,
  fetchCurrentMonthTournaments,
  fetchDayMatches,
  inferTournamentTimeZone,
  validateBwfUrl,
} from './lib/bwf'
import { browserTimeZoneLabel, convertHtmlTimeText, fetchRawPageHtml } from './lib/content'
import {
  applyThemeMeta,
  getSystemTheme,
  loadThemePreference,
  saveThemePreference,
  subscribeSystemTheme,
  subscribeThemeStorage,
  type ResolvedTheme,
  type ThemePreference,
} from './lib/theme'
import { getCurrentWeekDays, getCurrentYearAndMonth, getTodayIsoDate, isValidTimeZone } from './lib/time'
import {
  detectNewlyStartedMatchTimes,
  getMatchKey,
  isMatchUpcoming,
  loadActualStartTimes,
  resolveServingTeamsForMatches,
  saveActualStartTimes,
  subscribeActualStartTimesStorage,
  type ActualStartTimesMap,
  type MatchScoreSnapshot,
  type ServingTeamsMap,
} from './lib/schedule'
import { CurrentMonthTournaments } from './components/CurrentMonthTournaments'
import { ScheduleView } from './components/ScheduleView'
import { PageView } from './components/PageView'
import { ThemeSelector } from './components/ThemeSelector'
import { UpdateBanner } from './components/UpdateBanner'
import { WeekDateSelector } from './components/WeekDateSelector'
import {
  checkForAppUpdates,
  getAppVersion,
  getSafeReleaseUrl,
  isDesktopApp,
  loadDismissedUpdateVersion,
  saveDismissedUpdateVersion,
  type UpdateCheckResult,
} from './lib/update'
import {
  clampDesktopZoomFactor,
  getDesktopBridge,
  loadSavedZoomFactor,
  saveZoomFactor,
  type DesktopZoomAction,
} from './lib/desktop'

declare global {
  interface Window {
    __BWF_INITIAL_URL__?: string
  }
}

const APP_TITLE = 'BWF Match Schedule'
const DEFAULT_SOURCE_TIME_ZONE = 'Europe/Berlin'
const DEFAULT_AUTO_REFRESH_INTERVAL_SEC = 60

function getInitialUrl(): string {
  const queryUrl = new URLSearchParams(window.location.search).get('url')?.trim()
  if (queryUrl) {
    return queryUrl
  }
  return window.__BWF_INITIAL_URL__?.trim() ?? ''
}

interface ContentState {
  kind: 'schedule' | 'html'
  rawHtml: string | null
  pageTitle: string | null
  matches: DayMatch[] | null
  tournament: BwfTournament | null
  sourceTimeZone: string
  contextDate: string
  fetchedAtMs: number
}

export default function App() {
  const [initialUrl] = useState(() => getInitialUrl())
  const [initialValidation] = useState(() => (initialUrl ? validateBwfUrl(initialUrl) : null))
  const [url, setUrl] = useState(initialUrl)
  const [submittedUrl, setSubmittedUrl] = useState(() => (initialValidation?.valid ? initialValidation.normalizedUrl : ''))
  const [urlValidationError, setUrlValidationError] = useState<string | null>(() =>
    initialValidation && !initialValidation.valid ? initialValidation.error : null,
  )
  const [urlAnnouncement, setUrlAnnouncement] = useState('')
  const [todayIso, setTodayIso] = useState(() => getTodayIsoDate())
  const [sourceTimeZone, setSourceTimeZone] = useState(DEFAULT_SOURCE_TIME_ZONE)
  const [content, setContent] = useState<ContentState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [refreshKey, setRefreshKey] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [autoRefreshIntervalSec, setAutoRefreshIntervalSec] = useState(DEFAULT_AUTO_REFRESH_INTERVAL_SEC)
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number | null>(null)
  const [onlyInProgress, setOnlyInProgress] = useState(false)
  const [selectedCountry, setSelectedCountry] = useState('')
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemePreference())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())
  const [actualStartTimes, setActualStartTimes] = useState<ActualStartTimesMap>(() => loadActualStartTimes())
  const [servingTeams, setServingTeams] = useState<ServingTeamsMap>({})
  const [calendarTournaments, setCalendarTournaments] = useState<CalendarTournament[]>([])
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [calendarRetryKey, setCalendarRetryKey] = useState(0)
  const [resolvingTournamentId, setResolvingTournamentId] = useState<string | null>(null)
  const [resolveTournamentError, setResolveTournamentError] = useState<string | null>(null)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [manualUpdateStatus, setManualUpdateStatus] = useState<string | null>(null)
  const [zoomFactor, setZoomFactor] = useState(1)

  const desktopApp = isDesktopApp()
  const appVersion = getAppVersion()

  const manualTimeZoneOverrideRef = useRef(false)
  const sourceTimeZoneRef = useRef(sourceTimeZone)
  const autoRefreshRef = useRef(autoRefresh)
  const autoRefreshIntervalSecRef = useRef(autoRefreshIntervalSec)
  const actualStartTimesRef = useRef(actualStartTimes)
  const matchSnapshotRef = useRef<{
    scopeKey: string
    upcomingByKey: Map<string, boolean>
    fetchedAtMs: number
    autoRefreshWasEnabled: boolean
  } | null>(null)
  const scoreSnapshotRef = useRef<{
    scopeKey: string
    snapshots: Map<string, MatchScoreSnapshot>
  } | null>(null)
  const loadIdRef = useRef(0)
  const selectTournamentSeqRef = useRef(0)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const urlDirtyRef = useRef(Boolean(initialValidation && !initialValidation.valid))
  const urlHasBlurredRef = useRef(Boolean(initialValidation && !initialValidation.valid))
  const announceTimerRef = useRef<number | null>(null)

  const weekDays = useMemo(() => {
    void todayIso
    return getCurrentWeekDays()
  }, [todayIso])

  const {
    year: currentYear,
    monthLabel: currentMonthLabel,
    monthNameUpper: currentMonthUpper,
  } = useMemo(() => {
    void todayIso
    return getCurrentYearAndMonth()
  }, [todayIso])

  const activeUrlDate = useMemo(() => extractTrailingIsoDate(url), [url])
  const activeTournamentId = useMemo(() => extractTournamentIdFromUrl(url), [url])

  useEffect(() => {
    let cancelled = false
    void fetchCurrentMonthTournaments(currentYear, currentMonthUpper)
      .then((list) => {
        if (!cancelled) {
          setCalendarTournaments(list)
          setCalendarError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCalendarError(e instanceof Error ? e.message : 'Failed to load calendar tournaments')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCalendarLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [currentYear, currentMonthUpper, calendarRetryKey])

  useEffect(() => {
    const refreshToday = () => {
      const next = getTodayIsoDate()
      setTodayIso((current) => (current === next ? current : next))
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshToday()
      }
    }
    window.addEventListener('focus', refreshToday)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', refreshToday)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const input = urlInputRef.current
    if (!input) {
      return
    }
    const validation = validateBwfUrl(url)
    input.setCustomValidity(validation.valid ? '' : validation.error)
  }, [url])

  useEffect(
    () => () => {
      if (announceTimerRef.current !== null) {
        window.clearTimeout(announceTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    sourceTimeZoneRef.current = sourceTimeZone
  }, [sourceTimeZone])

  useEffect(() => {
    autoRefreshRef.current = autoRefresh
    if (!autoRefresh && matchSnapshotRef.current) {
      matchSnapshotRef.current.autoRefreshWasEnabled = false
    }
  }, [autoRefresh])

  useEffect(() => {
    autoRefreshIntervalSecRef.current = autoRefreshIntervalSec
  }, [autoRefreshIntervalSec])

  useEffect(() => {
    actualStartTimesRef.current = actualStartTimes
  }, [actualStartTimes])

  useEffect(
    () =>
      subscribeActualStartTimesStorage((next) => {
        actualStartTimesRef.current = next
        setActualStartTimes(next)
      }),
    [],
  )

  useEffect(() => {
    applyThemeMeta(themePreference)
  }, [themePreference])

  useEffect(() => subscribeSystemTheme(setSystemTheme), [])

  useEffect(
    () =>
      subscribeThemeStorage((next) => {
        setThemePreference(next)
        applyThemeMeta(next)
      }),
    [],
  )

  const handleThemeChange = useCallback((next: ThemePreference) => {
    setThemePreference(next)
    saveThemePreference(next)
    applyThemeMeta(next)
  }, [])

  useEffect(() => {
    if (!desktopApp) {
      return
    }
    const controller = new AbortController()
    void checkForAppUpdates(false, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          return
        }
        setUpdateResult(result)
        if (result.status === 'update-available' && result.latestVersion) {
          setUpdateBannerDismissed(loadDismissedUpdateVersion() === result.latestVersion)
        }
      })
      .catch(() => {
        // Startup background update checks fail silently when offline.
      })
    return () => {
      controller.abort()
    }
  }, [desktopApp])

  const handleManualUpdateCheck = useCallback(async () => {
    if (!desktopApp || checkingUpdates) {
      return
    }
    setCheckingUpdates(true)
    setManualUpdateStatus(null)
    try {
      const result = await checkForAppUpdates(true)
      setUpdateResult(result)
      if (result.status === 'update-available' && result.latestVersion) {
        setUpdateBannerDismissed(false)
        setManualUpdateStatus(`Update available: v${result.latestVersion}`)
      } else if (result.status === 'up-to-date') {
        setManualUpdateStatus(`You are up to date (v${result.currentVersion})`)
      } else {
        setManualUpdateStatus(result.error ?? 'Unable to check for updates right now.')
      }
    } catch {
      setManualUpdateStatus('Unable to check for updates right now.')
    } finally {
      setCheckingUpdates(false)
    }
  }, [checkingUpdates, desktopApp])

  const handleDismissUpdateBanner = useCallback(() => {
    if (updateResult?.latestVersion) {
      saveDismissedUpdateVersion(updateResult.latestVersion)
    }
    setUpdateBannerDismissed(true)
  }, [updateResult])

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!desktopApp || !bridge) {
      return
    }
    let active = true
    const savedZoom = loadSavedZoomFactor()
    const initPromise =
      savedZoom !== null && Math.abs(savedZoom - 1) > 0.001
        ? bridge.setZoomFactor(savedZoom)
        : bridge.getZoomFactor()
    void initPromise.then((factor) => {
      if (active) {
        const clamped = clampDesktopZoomFactor(factor)
        setZoomFactor(clamped)
        saveZoomFactor(clamped)
      }
    })

    const unsubscribe = bridge.onZoomChanged((factor) => {
      const clamped = clampDesktopZoomFactor(factor)
      setZoomFactor(clamped)
      saveZoomFactor(clamped)
    })

    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.deltaY === 0) {
        return
      }
      event.preventDefault()
      void bridge.zoom(event.deltaY < 0 ? 'in' : 'out')
    }
    window.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('wheel', handleWheel)
    }
  }, [desktopApp])

  const handleDesktopZoom = useCallback((action: DesktopZoomAction) => {
    const bridge = getDesktopBridge()
    if (!bridge) {
      return
    }
    void bridge.zoom(action)
  }, [])

  const runLoad = useCallback(async (targetUrl: string) => {
    const loadId = ++loadIdRef.current
    setLoading(true)
    setError(null)
    try {
      const withProtocol = /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`
      const details = await fetchBwfTournamentDetails(withProtocol)
      if (loadId !== loadIdRef.current) {
        return
      }
      if (details) {
        const urlDateMatch = /(\d{4}-\d{2}-\d{2})\/?$/.exec(new URL(withProtocol).pathname)?.[1]
        const startDate = details.tournament.start_date.slice(0, 10)
        const contextDate = urlDateMatch ?? startDate
        const matches = await fetchDayMatches(details.tournament.code, contextDate)
        if (loadId !== loadIdRef.current) {
          return
        }

        const scopeKey = `${details.tournament.code}:${contextDate}`
        const fetchedAtMs = Date.now()
        const prevSnapshot = matchSnapshotRef.current
        const maxPollGapMs = Math.max(autoRefreshIntervalSecRef.current * 1000 * 2, 3 * 60 * 1000)

        if (
          prevSnapshot &&
          prevSnapshot.scopeKey === scopeKey &&
          prevSnapshot.autoRefreshWasEnabled &&
          autoRefreshRef.current &&
          fetchedAtMs - prevSnapshot.fetchedAtMs <= maxPollGapMs
        ) {
          const newlyCaptured = detectNewlyStartedMatchTimes({
            matches,
            tournamentCode: details.tournament.code,
            previousUpcomingByKey: prevSnapshot.upcomingByKey,
            existingActualStartTimes: actualStartTimesRef.current,
            nowMs: fetchedAtMs,
          })
          if (Object.keys(newlyCaptured).length > 0) {
            const merged = saveActualStartTimes(
              { ...actualStartTimesRef.current, ...newlyCaptured },
              fetchedAtMs,
            )
            actualStartTimesRef.current = merged
            setActualStartTimes(merged)
          }
        }

        const nextUpcomingByKey = new Map<string, boolean>()
        for (const match of matches) {
          nextUpcomingByKey.set(getMatchKey(match, details.tournament.code), isMatchUpcoming(match))
        }
        matchSnapshotRef.current = {
          scopeKey,
          upcomingByKey: nextUpcomingByKey,
          fetchedAtMs,
          autoRefreshWasEnabled: autoRefreshRef.current,
        }

        const previousScoreSnapshots =
          scoreSnapshotRef.current && scoreSnapshotRef.current.scopeKey === scopeKey
            ? scoreSnapshotRef.current.snapshots
            : new Map<string, MatchScoreSnapshot>()
        const { servingTeams: nextServingTeams, snapshots: nextScoreSnapshots } = resolveServingTeamsForMatches(
          matches,
          details.tournament.code,
          previousScoreSnapshots,
        )
        scoreSnapshotRef.current = {
          scopeKey,
          snapshots: nextScoreSnapshots,
        }
        setServingTeams(nextServingTeams)

        const currentTz = sourceTimeZoneRef.current.trim()
        let resolvedTimeZone = isValidTimeZone(currentTz) ? currentTz : DEFAULT_SOURCE_TIME_ZONE
        if (!manualTimeZoneOverrideRef.current) {
          let detected = inferTournamentTimeZone(details.tournament, matches)
          if (!detected && matches.length === 0 && startDate !== contextDate) {
            try {
              const fallbackMatches = await fetchDayMatches(details.tournament.code, startDate)
              if (loadId !== loadIdRef.current) {
                return
              }
              detected = inferTournamentTimeZone(details.tournament, fallbackMatches)
            } catch {
              // Fall back to tournament metadata or current timezone if start-date probe fails.
            }
          }
          if (detected) {
            resolvedTimeZone = detected
            setSourceTimeZone(detected)
          }
        }

        setContent({
          kind: 'schedule',
          rawHtml: null,
          pageTitle: null,
          matches,
          tournament: details.tournament,
          sourceTimeZone: resolvedTimeZone,
          contextDate,
          fetchedAtMs,
        })
      } else {
        const { rawHtml, contextDate, pageTitle } = await fetchRawPageHtml(withProtocol)
        if (loadId !== loadIdRef.current) {
          return
        }
        const currentTz = sourceTimeZoneRef.current.trim()
        const resolvedTimeZone = isValidTimeZone(currentTz) ? currentTz : DEFAULT_SOURCE_TIME_ZONE
        setContent({
          kind: 'html',
          rawHtml,
          pageTitle,
          matches: null,
          tournament: null,
          sourceTimeZone: resolvedTimeZone,
          contextDate,
          fetchedAtMs: Date.now(),
        })
      }
    } catch (e) {
      if (loadId === loadIdRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load the page content')
      }
    } finally {
      if (loadId === loadIdRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const scheduleErrorAnnouncement = useCallback((message: string) => {
    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current)
    }
    setUrlAnnouncement('')
    announceTimerRef.current = window.setTimeout(() => {
      announceTimerRef.current = null
      setUrlAnnouncement(`Match schedule page URL: Error: ${message}`)
    }, 500)
  }, [])

  const clearErrorAnnouncement = useCallback(() => {
    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current)
      announceTimerRef.current = null
    }
    setUrlAnnouncement('')
  }, [])

  const handleSubmitUrl = useCallback(
    (nextUrl: string) => {
      const validation = validateBwfUrl(nextUrl)
      if (!validation.valid) {
        urlDirtyRef.current = true
        urlHasBlurredRef.current = true
        clearErrorAnnouncement()
        setUrlValidationError(validation.error)
        if (urlInputRef.current) {
          urlInputRef.current.setCustomValidity(validation.error)
          urlInputRef.current.focus()
        }
        return
      }
      clearErrorAnnouncement()
      setUrlValidationError(null)
      if (urlInputRef.current) {
        urlInputRef.current.setCustomValidity('')
      }
      const normalized = validation.normalizedUrl
      if (normalized !== submittedUrl) {
        manualTimeZoneOverrideRef.current = false
        setSelectedCountry('')
      }
      setUrl(normalized)
      setSubmittedUrl(normalized)
      setRefreshKey((key) => key + 1)
    },
    [submittedUrl, clearErrorAnnouncement],
  )

  const handleEnableAutoRefresh = useCallback(() => {
    setAutoRefresh(true)
    setAutoRefreshIntervalSec((current) => Math.min(current, 60))
  }, [])

  const loadNow = useCallback(() => {
    handleSubmitUrl(url)
  }, [handleSubmitUrl, url])

  const handleUrlFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      handleSubmitUrl(url)
    },
    [handleSubmitUrl, url],
  )

  const handleSelectWeekDate = useCallback(
    (isoDate: string) => {
      const nextUrl = applyDateToUrl(url, isoDate)
      if (!nextUrl) {
        const message = url.trim()
          ? 'Please enter a valid URL first, then choose a day to set YYYY-MM-DD.'
          : 'Enter a BWF results URL first, then choose a day to append YYYY-MM-DD.'
        urlDirtyRef.current = true
        urlHasBlurredRef.current = true
        clearErrorAnnouncement()
        setUrlValidationError(message)
        if (urlInputRef.current) {
          urlInputRef.current.setCustomValidity(message)
          urlInputRef.current.focus()
        }
        return
      }
      manualTimeZoneOverrideRef.current = false
      handleSubmitUrl(nextUrl)
    },
    [url, handleSubmitUrl, clearErrorAnnouncement],
  )

  const handleRetryCalendar = useCallback(() => {
    setCalendarLoading(true)
    setCalendarError(null)
    setCalendarRetryKey((key) => key + 1)
  }, [])

  const handleSelectTournament = useCallback(
    async (tournament: CalendarTournament) => {
      const requestSeq = ++selectTournamentSeqRef.current
      setResolvingTournamentId(tournament.id)
      setResolveTournamentError(null)
      try {
        const details = await fetchBwfTournamentById(tournament.id)
        if (requestSeq !== selectTournamentSeqRef.current) {
          return
        }
        const dateIso = getTodayIsoDate()
        const targetUrl = buildTournamentResultsUrl(details.tmtLink, tournament.id, details.slug, dateIso)
        handleSubmitUrl(targetUrl)
      } catch (e) {
        if (requestSeq === selectTournamentSeqRef.current) {
          setResolveTournamentError(
            e instanceof Error ? e.message : `Failed to resolve URL for ${tournament.name}`,
          )
        }
      } finally {
        if (requestSeq === selectTournamentSeqRef.current) {
          setResolvingTournamentId(null)
        }
      }
    },
    [handleSubmitUrl],
  )

  useEffect(() => {
    if (!submittedUrl.trim()) {
      return
    }
    void runLoad(submittedUrl)
  }, [submittedUrl, refreshKey, runLoad])

  useEffect(() => {
    if (!autoRefresh) {
      setSecondsUntilRefresh(null)
      return
    }
    setSecondsUntilRefresh(autoRefreshIntervalSec)
    const countdownId = window.setInterval(() => {
      setSecondsUntilRefresh((current) => Math.max(0, (current ?? autoRefreshIntervalSec) - 1))
    }, 1000)
    const refreshId = window.setInterval(() => {
      setRefreshKey((key) => key + 1)
    }, autoRefreshIntervalSec * 1000)
    return () => {
      window.clearInterval(countdownId)
      window.clearInterval(refreshId)
    }
  }, [autoRefresh, autoRefreshIntervalSec, refreshKey])

  useEffect(() => {
    if (secondsUntilRefresh === null) {
      return
    }
    if (secondsUntilRefresh <= 0) {
      setSecondsUntilRefresh(null)
      setRefreshKey((key) => key + 1)
    }
  }, [secondsUntilRefresh])

  const activeTournamentTitle = useMemo(() => {
    if (content?.kind === 'schedule') {
      return content.tournament?.name?.trim() || null
    }
    if (content?.kind === 'html') {
      return content.pageTitle?.trim() || null
    }
    return null
  }, [content])

  useEffect(() => {
    document.title = activeTournamentTitle ? `${activeTournamentTitle} — ${APP_TITLE}` : APP_TITLE
    return () => {
      document.title = APP_TITLE
    }
  }, [activeTournamentTitle])

  const activeSourceTimeZone = isValidTimeZone(sourceTimeZone)
    ? sourceTimeZone.trim()
    : (content?.sourceTimeZone ?? DEFAULT_SOURCE_TIME_ZONE)

  const convertedHtml = useMemo(() => {
    if (content?.kind !== 'html' || !content.rawHtml) {
      return null
    }
    return convertHtmlTimeText(content.rawHtml, activeSourceTimeZone, content.contextDate)
  }, [content, activeSourceTimeZone])

  const timezoneSuggestions = [
    'Europe/Berlin',
    'Europe/London',
    'Europe/Paris',
    'Europe/Madrid',
    'Europe/Amsterdam',
    'Europe/Copenhagen',
    'Europe/Zurich',
    'Europe/Helsinki',
    'Africa/Cairo',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Bangkok',
    'Asia/Jakarta',
    'Asia/Kuala_Lumpur',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Taipei',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Pacific/Auckland',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'UTC',
  ]

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-main">
          <div className="app-header-brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
                <path
                  d="M16 25c-2.6 0-4.6-1.7-4.6-4 0-.9.3-1.8.9-2.4h7.4c.6.6.9 1.5.9 2.4 0 2.3-2 4-4.6 4Z"
                  fill="currentColor"
                />
                <path d="M11.6 18.6h8.8" stroke="var(--brand-crimson)" strokeWidth="2.4" strokeLinecap="round" />
                <path
                  d="M12.3 17.5 7.4 8.8l5.3 1.7L16 7.2l3.3 3.3 5.3-1.7-4.9 8.7"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M16 7.4v10.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
              </svg>
            </span>
            <div className="app-header-copy">
              <h1>BWF Match Schedule</h1>
              <p className="app-subtitle">
                Fetch a BWF tournament match schedule page and re-render the times in your local timezone ({browserTimeZoneLabel()}).
              </p>
            </div>
          </div>
        </div>
        <div className="app-header-actions">
          <ThemeSelector value={themePreference} systemTheme={systemTheme} onChange={handleThemeChange} />
        </div>
      </header>

      <section className="controls">
        <form className="control-row" onSubmit={handleUrlFormSubmit} noValidate>
          <div className="control-label-row">
            <label className="control-label" htmlFor="bwf-url-input">
              Match schedule page URL
            </label>
            <span id="bwf-url-hint" className="control-hint">
              Must end with a date in <code>YYYY-MM-DD</code> format (for example{' '}
              <code>.../results/{todayIso}</code>).
            </span>
          </div>
          <div className="control-input-row">
            <input
              ref={urlInputRef}
              id="bwf-url-input"
              name="bwfUrl"
              className={`url-input${urlValidationError ? ' user-invalid-fallback' : ''}`}
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCorrect="off"
              autoCapitalize="none"
              enterKeyHint="go"
              required
              value={url}
              placeholder={`https://bwfworldtour.bwfbadminton.com/tournament/.../results/${todayIso}`}
              autoFocus
              aria-invalid={urlValidationError ? 'true' : 'false'}
              aria-describedby={urlValidationError ? 'bwf-url-hint bwf-url-error' : 'bwf-url-hint'}
              onChange={(event) => {
                const nextValue = event.target.value
                manualTimeZoneOverrideRef.current = false
                urlDirtyRef.current = true
                setUrl(nextValue)
                const validation = validateBwfUrl(nextValue)
                if (validation.valid) {
                  event.currentTarget.setCustomValidity('')
                  setUrlValidationError(null)
                  clearErrorAnnouncement()
                } else {
                  event.currentTarget.setCustomValidity(validation.error)
                  if (urlHasBlurredRef.current) {
                    setUrlValidationError(validation.error)
                  }
                }
              }}
              onBlur={(event) => {
                urlHasBlurredRef.current = true
                if (!urlDirtyRef.current) {
                  return
                }
                const validation = validateBwfUrl(event.currentTarget.value)
                if (validation.valid) {
                  event.currentTarget.setCustomValidity('')
                  setUrlValidationError(null)
                  clearErrorAnnouncement()
                } else {
                  event.currentTarget.setCustomValidity(validation.error)
                  setUrlValidationError(validation.error)
                  scheduleErrorAnnouncement(validation.error)
                }
              }}
              spellCheck={false}
            />
            <button type="submit" className="btn" disabled={loading}>
              Refresh
            </button>
          </div>
          <div id="bwf-url-error" className="control-error" hidden={!urlValidationError}>
            <svg
              className="control-error-icon"
              viewBox="0 0 16 16"
              width="15"
              height="15"
              role="img"
              aria-label="Error"
              fill="currentColor"
            >
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM8 11.75a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
            </svg>
            <span>{urlValidationError}</span>
          </div>
        </form>

        <WeekDateSelector
          days={weekDays}
          selectedDate={activeUrlDate}
          onSelectDate={handleSelectWeekDate}
        />

        <CurrentMonthTournaments
          monthLabel={currentMonthLabel}
          year={currentYear}
          tournaments={calendarTournaments}
          loading={calendarLoading}
          error={calendarError}
          resolvingId={resolvingTournamentId}
          resolveError={resolveTournamentError}
          activeTournamentId={activeTournamentId}
          onSelectTournament={(tournament) => {
            void handleSelectTournament(tournament)
          }}
          onRetryLoad={handleRetryCalendar}
        />

        <div className="controls-secondary-grid">
          <div className="control-row">
            <label className="control-label" htmlFor="bwf-source-tz-input">
              Source timezone
            </label>
            <input
              id="bwf-source-tz-input"
              className="tz-input"
              type="text"
              list="bwf-timezone-suggestions"
              value={sourceTimeZone}
              onChange={(event) => {
                manualTimeZoneOverrideRef.current = true
                setSourceTimeZone(event.target.value)
              }}
              placeholder="Europe/Berlin"
            />
            <datalist id="bwf-timezone-suggestions">
              {timezoneSuggestions.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      <main className="content-area">
        {loading && !content ? (
          <div className="status-box">Loading…</div>
        ) : null}
        {error ? <div className="status-box error-box">Failed to load: {error}</div> : null}
        {content?.kind === 'schedule' && content.matches && content.tournament ? (
          <ScheduleView
            tournamentCode={content.tournament.code}
            tournamentName={content.tournament.name}
            venue={[content.tournament.venue_name, content.tournament.venue_address1].filter(Boolean).join(', ')}
            contextDate={content.contextDate}
            sourceTimeZone={activeSourceTimeZone}
            matches={content.matches}
            onlyInProgress={onlyInProgress}
            onOnlyInProgressChange={setOnlyInProgress}
            selectedCountry={selectedCountry}
            onSelectedCountryChange={setSelectedCountry}
            loading={loading}
            onRefreshNow={loadNow}
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
            autoRefreshIntervalSec={autoRefreshIntervalSec}
            onAutoRefreshIntervalChange={setAutoRefreshIntervalSec}
            secondsUntilRefresh={secondsUntilRefresh}
            onEnableAutoRefresh={handleEnableAutoRefresh}
            actualStartTimes={actualStartTimes}
            servingTeams={servingTeams}
            fetchedAtMs={content.fetchedAtMs}
          />
        ) : null}
        {content?.kind === 'html' && convertedHtml ? <PageView html={convertedHtml} /> : null}
        {!content && !loading && !error ? (
          <div className="status-box">Enter a BWF match schedule page URL ending with YYYY-MM-DD above and press Refresh.</div>
        ) : null}
      </main>

      <div className="visually-hidden" aria-live="polite">
        {urlAnnouncement}
      </div>

      <footer className="app-footer">
        <span className="footer-note">Content is fetched live from the BWF website.</span>
        <div className="footer-meta">
          {desktopApp ? (
            <div className="footer-zoom-group" role="group" aria-label="Zoom">
              <button
                type="button"
                className="footer-zoom-btn"
                aria-label="Zoom out"
                onClick={() => handleDesktopZoom('out')}
                disabled={zoomFactor <= 0.5}
              >
                −
              </button>
              <button
                type="button"
                className="footer-zoom-btn footer-zoom-reset"
                aria-label={`Reset zoom (currently ${Math.round(zoomFactor * 100)}%)`}
                onClick={() => handleDesktopZoom('reset')}
                disabled={Math.abs(zoomFactor - 1) < 0.005}
              >
                {Math.round(zoomFactor * 100)}%
              </button>
              <button
                type="button"
                className="footer-zoom-btn"
                aria-label="Zoom in"
                onClick={() => handleDesktopZoom('in')}
                disabled={zoomFactor >= 3}
              >
                +
              </button>
            </div>
          ) : null}
          <span className="footer-version">v{appVersion}</span>
          {desktopApp ? (
            <>
              <button
                type="button"
                className="footer-update-btn"
                onClick={() => void handleManualUpdateCheck()}
                disabled={checkingUpdates}
              >
                {checkingUpdates ? 'Checking…' : 'Check for updates'}
              </button>
              {updateResult?.status === 'update-available' && updateResult.latestVersion ? (
                <a
                  href={getSafeReleaseUrl(updateResult.releaseUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-update-link"
                >
                  Download v{updateResult.latestVersion}
                </a>
              ) : null}
              {manualUpdateStatus && updateResult?.status !== 'update-available' ? (
                <span className="footer-update-status" role="status" aria-live="polite">
                  {manualUpdateStatus}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </footer>

      {desktopApp &&
      updateResult?.status === 'update-available' &&
      updateResult.latestVersion &&
      !updateBannerDismissed ? (
        <UpdateBanner
          currentVersion={updateResult.currentVersion}
          latestVersion={updateResult.latestVersion}
          releaseUrl={updateResult.releaseUrl}
          onDismiss={handleDismissUpdateBanner}
        />
      ) : null}
    </div>
  )
}
