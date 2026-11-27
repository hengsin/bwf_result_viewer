import { getSafeReleaseUrl } from '../lib/update'

interface UpdateBannerProps {
  currentVersion: string
  latestVersion: string
  releaseUrl: string | null
  onDismiss: () => void
}

/**
 * Non-modal floating update notice for the standalone desktop build.
 * Positioned fixed at bottom-start so it does not shift layout while reading.
 */
export function UpdateBanner({
  currentVersion,
  latestVersion,
  releaseUrl,
  onDismiss,
}: UpdateBannerProps) {
  const safeUrl = getSafeReleaseUrl(releaseUrl)

  return (
    <aside className="update-banner" aria-label="Application update available">
      <div className="update-banner-accent" aria-hidden="true" />
      <div className="update-banner-body">
        <div className="update-banner-title">Update available: v{latestVersion}</div>
        <p className="update-banner-message">
          You are running v{currentVersion}. A newer release is ready on GitHub.
        </p>
        <div className="update-banner-actions">
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="update-banner-link"
          >
            Download update
          </a>
        </div>
      </div>
      <button
        type="button"
        className="update-banner-close"
        aria-label={`Close update notice for v${latestVersion}`}
        onClick={onDismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </aside>
  )
}
