import { useId, useState } from 'react'
import type { CalendarTournament } from '../lib/bwf'

interface CurrentMonthTournamentsProps {
  monthLabel: string
  year: number
  tournaments: CalendarTournament[]
  loading: boolean
  error: string | null
  resolvingId: string | null
  resolveError: string | null
  activeTournamentId: string | null
  onSelectTournament: (tournament: CalendarTournament) => void
  onRetryLoad: () => void
}

export function CurrentMonthTournaments({
  monthLabel,
  year,
  tournaments,
  loading,
  error,
  resolvingId,
  resolveError,
  activeTournamentId,
  onSelectTournament,
  onRetryLoad,
}: CurrentMonthTournamentsProps) {
  const [expanded, setExpanded] = useState(true)
  const panelId = useId()

  return (
    <div className="control-row month-tournaments">
      <div className="month-tournaments-header">
        <div className="month-tournaments-title-group">
          <h2 className="control-label month-tournaments-heading">
            {monthLabel} {year} tournaments
          </h2>
          {!loading && !error ? (
            <span className="month-tournaments-count">
              {tournaments.length} {tournaments.length === 1 ? 'event' : 'events'}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="sidebar-text-btn"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Hide list' : 'Show list'}
        </button>
      </div>

      <div id={panelId} className="month-tournaments-body" hidden={!expanded}>
        {loading ? (
          <div className="month-tournaments-status">
            <progress aria-label={`Loading ${monthLabel} ${year} tournaments`} className="loading-spinner" />
            <span>Loading {monthLabel} {year} tournaments…</span>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="month-tournaments-error" role="alert">
            <span>Could not load {monthLabel} {year} calendar: {error}</span>
            <button type="button" className="btn btn-secondary month-retry-btn" onClick={onRetryLoad}>
              Retry
            </button>
          </div>
        ) : null}

        {resolveError ? (
          <div className="month-tournaments-error" role="alert">
            <span>{resolveError}</span>
          </div>
        ) : null}

        {!loading && !error && tournaments.length === 0 ? (
          <div className="month-tournaments-empty">
            No tournaments listed for {monthLabel} {year}.
          </div>
        ) : null}

        {!loading && !error && tournaments.length > 0 ? (
          <ul className="tournament-list">
            {tournaments.map((tournament) => {
              const isSelected = activeTournamentId === tournament.id
              const isResolving = resolvingId === tournament.id
              const location = [tournament.city, tournament.countryCode].filter(Boolean).join(', ')
              const metaParts = [
                tournament.dates ? `${tournament.dates} ${monthLabel.slice(0, 3)}` : '',
                location,
                tournament.category,
              ].filter(Boolean)

              return (
                <li key={tournament.id} className="tournament-list-item">
                  <button
                    type="button"
                    className={`tournament-item-btn${isSelected ? ' is-active' : ''}`}
                    aria-pressed={isSelected}
                    disabled={resolvingId !== null}
                    onClick={() => onSelectTournament(tournament)}
                  >
                    <span className="tournament-item-top">
                      <span className="tournament-item-name">{tournament.name}</span>
                      {isResolving ? (
                        <progress
                          aria-label={`Opening ${tournament.name}`}
                          className="loading-spinner is-sm"
                        />
                      ) : null}
                    </span>
                    {metaParts.length > 0 ? (
                      <span className="tournament-item-meta">{metaParts.join(' · ')}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
