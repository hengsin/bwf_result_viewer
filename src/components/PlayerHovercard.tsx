import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { BwfPlayer } from '../lib/bwf'
import {
  fetchPlayerProfile,
  getCachedPlayerProfile,
  type PlayerProfileData,
} from '../lib/playerProfile'
import { playerDisplayName, toSafeHttpsUrl } from '../lib/schedule'
import { CountryFlag } from './CountryFlag'

export interface HoveredPlayerTarget {
  triggerKey: string
  player: BwfPlayer
  eventName: string
  partnerId: string | null
  profileUrl: string | null
}

interface PlayerHovercardProps {
  hovercardId: string
  hovercardRef: RefObject<HTMLDivElement | null>
  target: HoveredPlayerTarget | null
  fallbackPosition: { top: number; left: number } | null
  onMouseEnterCard: () => void
  onMouseLeaveCard: () => void
}

function deriveInitials(player: BwfPlayer, displayName: string): string {
  const raw = player.initials?.trim()
  if (raw) {
    return raw.slice(0, 3).toUpperCase()
  }
  const parts = displayName.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
  }
  return displayName.slice(0, 2).toUpperCase() || '?'
}

function formatRankDate(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) {
    return raw
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(date.getTime())) {
    return raw
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Shared hint popover hovercard displaying a player's BWF profile, ranking, and bio details.
 */
export function PlayerHovercard({
  hovercardId,
  hovercardRef,
  target,
  fallbackPosition,
  onMouseEnterCard,
  onMouseLeaveCard,
}: PlayerHovercardProps) {
  const playerId = target?.player.id?.trim() ?? ''
  const eventName = target?.eventName ?? ''
  const partnerId = target?.partnerId ?? null

  const [loadedState, setLoadedState] = useState<{
    key: string
    data: PlayerProfileData
  } | null>(null)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

  const requestKey = target ? `${playerId}|${eventName}|${partnerId ?? ''}` : ''
  const cachedProfile = target ? getCachedPlayerProfile(playerId, eventName, partnerId) : null
  const profile = cachedProfile ?? (loadedState?.key === requestKey ? loadedState.data : null)
  const isLoading = Boolean(target && !profile)

  useEffect(() => {
    if (!target || cachedProfile) {
      return
    }
    let cancelled = false
    const activeKey = requestKey
    void fetchPlayerProfile(target.player, target.eventName, target.partnerId).then((data) => {
      if (!cancelled) {
        setLoadedState({ key: activeKey, data })
      }
    })
    return () => {
      cancelled = true
    }
  }, [target, cachedProfile, requestKey])

  const displayName = target ? playerDisplayName(target.player) : ''
  const avatarUrl = target ? toSafeHttpsUrl(target.player.avatar?.thumbnailUrl) : null
  const showAvatarImg = Boolean(avatarUrl && failedAvatarUrl !== avatarUrl)
  const initials = target ? deriveInitials(target.player, displayName) : ''
  const countryLabel = target?.player.countryName?.trim() || target?.player.countryCode?.trim() || ''

  const hasBioStats = Boolean(
    profile &&
      (profile.age !== null ||
        profile.hand !== null ||
        profile.heightCm !== null ||
        profile.residence !== null ||
        profile.placeOfBirth !== null ||
        profile.prizeMoney !== null),
  )
  const hasRanking = Boolean(profile && (profile.currentRank !== null || profile.highestRank !== null))
  const highestDateLabel = formatRankDate(profile?.highestRankDate ?? null)

  return (
    <div
      id={hovercardId}
      ref={hovercardRef}
      role="tooltip"
      className="player-hovercard"
      style={fallbackPosition ? { top: `${fallbackPosition.top}px`, left: `${fallbackPosition.left}px` } : undefined}
      onMouseEnter={onMouseEnterCard}
      onMouseLeave={onMouseLeaveCard}
      {...({ popover: 'hint' } as Record<string, string>)}
    >
      {target ? (
        <div className="player-hovercard-content">
          <div className="player-hovercard-header">
            {showAvatarImg && avatarUrl ? (
              <img
                className="player-hovercard-avatar"
                src={avatarUrl}
                alt=""
                width={54}
                height={54}
                loading="eager"
                decoding="async"
                onError={() => setFailedAvatarUrl(avatarUrl)}
              />
            ) : (
              <span className="player-hovercard-avatar-fallback" aria-hidden="true">
                {initials}
              </span>
            )}

            <div className="player-hovercard-identity">
              <div className="player-hovercard-name">{displayName}</div>
              {countryLabel ? (
                <div className="player-hovercard-country">
                  <CountryFlag
                    flagUrl={target.player.countryFlagUrl}
                    countryCode={target.player.countryCode}
                    countryName={target.player.countryName}
                  />
                  <span>{countryLabel}</span>
                </div>
              ) : null}
            </div>
          </div>

          {isLoading ? (
            <div className="player-hovercard-loading">Loading BWF profile…</div>
          ) : (
            <>
              {hasRanking && profile ? (
                <div className="player-hovercard-ranking">
                  {profile.eventLabel ? (
                    <div className="player-hovercard-event">{profile.eventLabel}</div>
                  ) : null}
                  <div className="player-hovercard-ranks-row">
                    {profile.currentRank !== null ? (
                      <div className="player-hovercard-rank-box">
                        <span className="player-hovercard-stat-label">World Rank</span>
                        <span className="player-hovercard-rank-value">#{profile.currentRank}</span>
                      </div>
                    ) : null}
                    {profile.highestRank !== null ? (
                      <div className="player-hovercard-rank-box">
                        <span className="player-hovercard-stat-label">Career High</span>
                        <span className="player-hovercard-rank-value">
                          #{profile.highestRank}
                          {highestDateLabel ? (
                            <span className="player-hovercard-rank-date"> ({highestDateLabel})</span>
                          ) : null}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {hasBioStats && profile ? (
                <dl className="player-hovercard-stats">
                  {profile.age !== null ? (
                    <div className="player-hovercard-stat">
                      <dt>Age</dt>
                      <dd>{profile.age}</dd>
                    </div>
                  ) : null}
                  {profile.hand ? (
                    <div className="player-hovercard-stat">
                      <dt>Plays</dt>
                      <dd>{profile.hand}-handed</dd>
                    </div>
                  ) : null}
                  {profile.heightCm !== null ? (
                    <div className="player-hovercard-stat">
                      <dt>Height</dt>
                      <dd>{profile.heightCm} cm</dd>
                    </div>
                  ) : null}
                  {profile.residence ? (
                    <div className="player-hovercard-stat">
                      <dt>Residence</dt>
                      <dd>{profile.residence}</dd>
                    </div>
                  ) : null}
                  {!profile.residence && profile.placeOfBirth ? (
                    <div className="player-hovercard-stat">
                      <dt>Birthplace</dt>
                      <dd>{profile.placeOfBirth}</dd>
                    </div>
                  ) : null}
                  {profile.prizeMoney ? (
                    <div className="player-hovercard-stat">
                      <dt>Prize Money</dt>
                      <dd>${profile.prizeMoney}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : !hasRanking ? (
                <div className="player-hovercard-empty">No additional BWF bio details available.</div>
              ) : null}
            </>
          )}

          {target.profileUrl ? (
            <div className="player-hovercard-hint">Click name to open BWF profile</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
