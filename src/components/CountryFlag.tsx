import { useState } from 'react'
import { toSafeFlagUrl } from '../lib/schedule'

interface CountryFlagProps {
  flagUrl: string | null | undefined
  countryCode: string | null | undefined
  countryName?: string | null | undefined
}

/**
 * Renders a validated HTTPS country flag image with a country-code badge fallback.
 */
export function CountryFlag({ flagUrl, countryCode, countryName }: CountryFlagProps) {
  const safeUrl = toSafeFlagUrl(flagUrl)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const code = countryCode?.trim() || ''
  const label = countryName?.trim() || code

  if (safeUrl && failedUrl !== safeUrl) {
    return (
      <img
        className="country-flag"
        src={safeUrl}
        alt={code || label}
        title={label || undefined}
        width={18}
        height={18}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(safeUrl)}
      />
    )
  }

  if (code) {
    return (
      <span className="country-code-badge" title={label || undefined}>
        {code}
      </span>
    )
  }

  return null
}
