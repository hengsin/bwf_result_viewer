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
  saveActualStartTimes,
  subscribeActualStartTimesStorage,
  type ActualStartTimesMap,
} from './lib/schedule'
import { CurrentMonthTournaments } from './components/CurrentMonthTournaments'
import { ScheduleView } from './components/ScheduleView'
import { PageView } from './components/PageView'
import { ThemeSelector } from './components/ThemeSelector'
import { WeekDateSelector } from './components/WeekDateSelector'

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
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0')
  const rest = String(safe % 60).padStart(2, '0')
  return `${minutes}:${rest}`
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
  const [calendarTournaments, setCalendarTournaments] = useState<CalendarTournament[]>([])
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [calendarRetryKey, setCalendarRetryKey] = useState(0)
  const [resolvingTournamentId, setResolvingTournamentId] = useState<string | null>(null)
  const [resolveTournamentError, setResolveTournamentError] = useState<string | null>(null)

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

          <div className="control-row">
            <span className="control-label">Auto refresh</span>
            <div className="controls-row">
              <label className="auto-refresh-toggle" htmlFor="bwf-auto-refresh-toggle">
                <input
                  id="bwf-auto-refresh-toggle"
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                />
                Enabled
              </label>
              <select
                aria-label="Auto refresh interval"
                className="interval-select"
                value={autoRefreshIntervalSec}
                onChange={(event) => setAutoRefreshIntervalSec(Number(event.target.value))}
                disabled={!autoRefresh}
              >
                <option value={30}>every 30 seconds</option>
                <option value={60}>every minute</option>
                <option value={300}>every 5 minutes</option>
                <option value={900}>every 15 minutes</option>
                <option value={1800}>every 30 minutes</option>
                <option value={3600}>every hour</option>
              </select>
              <span className={`countdown${autoRefresh ? ' is-active' : ''}`}>
                {autoRefresh
                  ? `Next refresh in ${formatCountdown(secondsUntilRefresh ?? autoRefreshIntervalSec)}`
                  : 'Off'}
              </span>
            </div>
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
            autoRefresh={autoRefresh}
            onEnableAutoRefresh={handleEnableAutoRefresh}
            actualStartTimes={actualStartTimes}
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
        <button type="button" className="btn" onClick={loadNow} disabled={loading}>
          Refresh now
        </button>
        <span className="footer-note">Content is fetched live from the BWF website.</span>
      </footer>
    </div>
  )
}
