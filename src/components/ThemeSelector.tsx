import type { ResolvedTheme, ThemePreference } from '../lib/theme'

interface ThemeSelectorProps {
  value: ThemePreference
  systemTheme: ResolvedTheme
  onChange: (next: ThemePreference) => void
}

function SunIcon() {
  return (
    <svg
      className="theme-option-icon"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      className="theme-option-icon"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 9.8A5.5 5.5 0 0 1 6.2 2.5a5.5 5.5 0 1 0 7.3 7.3Z" />
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg
      className="theme-option-icon"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 13.5h5M8 11v2.5" />
    </svg>
  )
}

export function ThemeSelector({ value, systemTheme, onChange }: ThemeSelectorProps) {
  const systemLabel = systemTheme === 'dark' ? 'Dark' : 'Light'

  return (
    <fieldset className="control-row theme-selector">
      <legend className="control-label">Theme</legend>
      <div className="theme-segmented" role="radiogroup" aria-label="Color theme">
        <label className={`theme-option${value === 'light' ? ' is-active' : ''}`}>
          <input
            type="radio"
            name="bwf-theme"
            value="light"
            checked={value === 'light'}
            onChange={() => onChange('light')}
          />
          <SunIcon />
          <span>Light</span>
        </label>

        <label className={`theme-option${value === 'dark' ? ' is-active' : ''}`}>
          <input
            type="radio"
            name="bwf-theme"
            value="dark"
            checked={value === 'dark'}
            onChange={() => onChange('dark')}
          />
          <MoonIcon />
          <span>Dark</span>
        </label>

        <label
          className={`theme-option${value === 'system' ? ' is-active' : ''}`}
          title={`Follow system preference (currently ${systemTheme})`}
        >
          <input
            type="radio"
            name="bwf-theme"
            value="system"
            checked={value === 'system'}
            onChange={() => onChange('system')}
          />
          <SystemIcon />
          <span>System ({systemLabel})</span>
        </label>
      </div>
    </fieldset>
  )
}
