import type { MouseEvent, RefObject } from 'react'
import type { CountryOption, CourtFocusTarget, PinnedMatchHint } from '../lib/schedule'

export interface CourtSummary {
  id: string
  name: string
  location: string
  matchCount: number
  liveCount: number
  focusTarget: CourtFocusTarget | null
}

export interface PinnedSidebarItem {
  matchKey: string
  anchorId: string
  courtName: string
  summary: string
  hint: PinnedMatchHint
  isVisible: boolean
}

interface CourtSidebarProps {
  courts: CourtSummary[]
  totalMatchCount: number
  totalLiveCount: number
  activeCourtId: string | null
  useNativeTargetCurrent: boolean
  navRef: RefObject<HTMLElement | null>
  onSelectCourt: (courtId: string, event: MouseEvent<HTMLAnchorElement>) => void
  onlyInProgress: boolean
  onOnlyInProgressChange: (next: boolean) => void
  countries: CountryOption[]
  selectedCountry: string
  onSelectedCountryChange: (countryCode: string) => void
  pinnedMatches: PinnedSidebarItem[]
  onUnpinMatch: (matchKey: string) => void
  onJumpToMatch: (anchorId: string, clearFiltersIfHidden: boolean) => void
  notificationPermission: NotificationPermission | 'unsupported'
  onRequestNotificationPermission: () => void
  soundEnabled: boolean
  onToggleSound: (enabled: boolean) => void
  loading: boolean
  onRefreshNow: () => void
  autoRefresh: boolean
  onAutoRefreshChange: (enabled: boolean) => void
  autoRefreshIntervalSec: number
  onAutoRefreshIntervalChange: (seconds: number) => void
  secondsUntilRefresh: number | null
  onEnableAutoRefresh: () => void
  hasActiveFilters: boolean
  onResetFilters: () => void
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0')
  const rest = String(safe % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

/**
 * Sticky sidebar displaying refresh controls, schedule filters (in-progress & country),
 * pinned matches with start-alert controls, and quick anchor navigation between courts.
 */
export function CourtSidebar({
  courts,
  totalMatchCount,
  totalLiveCount,
  activeCourtId,
  useNativeTargetCurrent,
  navRef,
  onSelectCourt,
  onlyInProgress,
  onOnlyInProgressChange,
  countries,
  selectedCountry,
  onSelectedCountryChange,
  pinnedMatches,
  onUnpinMatch,
  onJumpToMatch,
  notificationPermission,
  onRequestNotificationPermission,
  soundEnabled,
  onToggleSound,
  loading,
  onRefreshNow,
  autoRefresh,
  onAutoRefreshChange,
  autoRefreshIntervalSec,
  onAutoRefreshIntervalChange,
  secondsUntilRefresh,
  onEnableAutoRefresh,
  hasActiveFilters,
  onResetFilters,
}: CourtSidebarProps) {
  const activeCourt = courts.find((court) => court.id === activeCourtId) ?? courts[0] ?? null
  const activeMatchWord = activeCourt && activeCourt.matchCount === 1 ? 'match' : 'matches'
  const activeCourtMeta = activeCourt
    ? activeCourt.liveCount > 1
      ? `${activeCourt.liveCount} live · ${activeCourt.matchCount} ${activeMatchWord}`
      : activeCourt.focusTarget?.kind === 'live'
        ? `In progress #${activeCourt.focusTarget.matchOrder} · ${activeCourt.matchCount} ${activeMatchWord}`
        : activeCourt.focusTarget?.kind === 'last-finished'
          ? `Last finished #${activeCourt.focusTarget.matchOrder} · ${activeCourt.matchCount} ${activeMatchWord}`
          : `${activeCourt.matchCount} ${activeMatchWord}`
    : ''

  return (
    <aside className="court-sidebar" aria-label="Schedule controls, filters, and court navigation">
      <div className="court-sidebar-panel">
        <div className="sidebar-section sidebar-refresh">
          <div className="sidebar-section-header">
            <span className="court-sidebar-eyebrow">Refresh</span>
            <span className={`countdown${autoRefresh ? ' is-active' : ''}`}>
              {autoRefresh
                ? `Next in ${formatCountdown(secondsUntilRefresh ?? autoRefreshIntervalSec)}`
                : 'Off'}
            </span>
          </div>

          <button type="button" className="btn sidebar-refresh-btn" onClick={onRefreshNow} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh now'}
          </button>

          <div className="sidebar-refresh-controls">
            <label className="auto-refresh-toggle" htmlFor="bwf-auto-refresh-toggle">
              <input
                id="bwf-auto-refresh-toggle"
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => onAutoRefreshChange(event.target.checked)}
              />
              <span>Auto refresh</span>
            </label>
            <select
              aria-label="Auto refresh interval"
              className="interval-select sidebar-interval-select"
              value={autoRefreshIntervalSec}
              onChange={(event) => onAutoRefreshIntervalChange(Number(event.target.value))}
              disabled={!autoRefresh}
            >
              <option value={30}>every 30 seconds</option>
              <option value={60}>every minute</option>
              <option value={300}>every 5 minutes</option>
              <option value={900}>every 15 minutes</option>
              <option value={1800}>every 30 minutes</option>
              <option value={3600}>every hour</option>
            </select>
          </div>
        </div>

        {totalMatchCount > 0 ? (
          <>
            <div className="sidebar-section sidebar-filters">
          <div className="sidebar-section-header">
            <span className="court-sidebar-eyebrow">Filters</span>
            {hasActiveFilters ? (
              <button type="button" className="sidebar-text-btn" onClick={onResetFilters}>
                Reset
              </button>
            ) : null}
          </div>

          <div className="sidebar-filter-row">
            <input
              id="bwf-only-in-progress"
              className="sidebar-checkbox"
              type="checkbox"
              checked={onlyInProgress}
              onChange={(event) => onOnlyInProgressChange(event.target.checked)}
            />
            <label className="sidebar-filter-label" htmlFor="bwf-only-in-progress">
              <span>In progress only</span>
              <span className={`sidebar-pill${totalLiveCount > 0 ? ' is-live' : ''}`}>
                {totalLiveCount > 0 ? <span className="court-live-dot" aria-hidden="true" /> : null}
                <span>{totalLiveCount}</span>
              </span>
            </label>
          </div>

          <div className="sidebar-field">
            <label className="sidebar-field-label" htmlFor="bwf-country-filter">
              Country
            </label>
            <select
              id="bwf-country-filter"
              name="country"
              className="country-select"
              value={selectedCountry}
              onChange={(event) => onSelectedCountryChange(event.target.value)}
            >
              <option value="">All countries ({totalMatchCount})</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name !== country.code ? `${country.name} (${country.code})` : country.code} ({country.matchCount})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="sidebar-section sidebar-pinned">
          <div className="sidebar-section-header">
            <span className="court-sidebar-eyebrow">Pinned matches</span>
            <span className="sidebar-pill">{pinnedMatches.length}</span>
          </div>

          {pinnedMatches.length === 0 ? (
            <p className="sidebar-empty-hint">
              Pin any match to get notified when it is about to start.
            </p>
          ) : (
            <>
              <ul className="pinned-list">
                {pinnedMatches.map((item) => (
                  <li className="pinned-item" key={item.matchKey}>
                    <button
                      type="button"
                      className="pinned-item-jump"
                      onClick={() => onJumpToMatch(item.anchorId, !item.isVisible)}
                    >
                      <span className="pinned-item-top">
                        <span className="pinned-item-court">{item.courtName}</span>
                        <span className={`pinned-hint-badge tone-${item.hint.tone}`}>
                          {item.hint.label}
                        </span>
                      </span>
                      <span className="pinned-item-summary">{item.summary}</span>
                    </button>
                    <button
                      type="button"
                      className="pinned-item-remove"
                      aria-label={`Unpin ${item.summary}`}
                      onClick={() => onUnpinMatch(item.matchKey)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="pinned-alerts-bar">
                {notificationPermission === 'default' ? (
                  <button
                    type="button"
                    className="sidebar-action-btn"
                    onClick={onRequestNotificationPermission}
                  >
                    Enable browser alerts
                  </button>
                ) : notificationPermission === 'granted' ? (
                  <span className="alert-status-note is-active">Browser alerts on</span>
                ) : notificationPermission === 'denied' ? (
                  <span className="alert-status-note">Browser alerts blocked</span>
                ) : null}

                <div className="sidebar-sound-row">
                  <input
                    id="bwf-alert-sound"
                    className="sidebar-checkbox"
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(event) => onToggleSound(event.target.checked)}
                  />
                  <label className="sidebar-sound-label" htmlFor="bwf-alert-sound">
                    Sound alert
                  </label>
                </div>
              </div>

              {!autoRefresh ? (
                <div className="sidebar-autorefresh-tip">
                  <span>Auto refresh is off — enable it to detect when the previous match finishes.</span>
                  <button type="button" className="sidebar-text-btn" onClick={onEnableAutoRefresh}>
                    Enable 1m refresh
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="sidebar-section sidebar-courts">
          {activeCourt ? (
            <>
              <div className="court-sidebar-current">
                <span className="court-sidebar-eyebrow">Viewing court</span>
                <strong className="court-sidebar-active-name">{activeCourt.name}</strong>
                <span className="court-sidebar-active-meta">{activeCourtMeta}</span>
              </div>

              <nav className="court-nav" aria-label="Courts" ref={navRef}>
                <ul className="court-nav-list">
                  {courts.map((court) => {
                    const isActive = court.id === activeCourt.id
                    const focusDescription =
                      court.focusTarget?.kind === 'live'
                        ? `Focus in-progress match #${court.focusTarget.matchOrder}: ${court.focusTarget.summary}`
                        : court.focusTarget?.kind === 'last-finished'
                          ? `Focus last finished match #${court.focusTarget.matchOrder}: ${court.focusTarget.summary}`
                          : `Jump to ${court.name}`
                    const srFocusHint =
                      court.focusTarget?.kind === 'live'
                        ? `, focuses in-progress match #${court.focusTarget.matchOrder}`
                        : court.focusTarget?.kind === 'last-finished'
                          ? `, focuses last finished match #${court.focusTarget.matchOrder}`
                          : null
                    return (
                      <li className="court-nav-item" key={court.id}>
                        <a
                          href={`#${court.id}`}
                          data-court-id={court.id}
                          title={focusDescription}
                          className={`court-nav-link${!useNativeTargetCurrent && isActive ? ' target-current' : ''}`}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={(event) => onSelectCourt(court.id, event)}
                        >
                          <span className="court-nav-name">
                            {court.liveCount > 0 ? <span className="court-live-dot" aria-hidden="true" /> : null}
                            <span>{court.name}</span>
                          </span>
                          <span className="court-nav-count">
                            {court.matchCount}
                            {court.liveCount > 0 ? <span className="visually-hidden"> ({court.liveCount} live)</span> : null}
                            {srFocusHint ? <span className="visually-hidden">{srFocusHint}</span> : null}
                          </span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </nav>
            </>
          ) : (
            <p className="sidebar-empty-hint">No courts match the active filters.</p>
          )}
        </div>
          </>
        ) : null}
      </div>
    </aside>
  )
}
