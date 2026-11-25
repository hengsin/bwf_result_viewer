export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'bwf:color-scheme:v1'

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  if (value === 'light' || value === 'dark') {
    return value
  }
  return 'system'
}

export function loadThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system'
  }
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference)
    }
  } catch {
    // Theme still applies to the current session even when storage is blocked.
  }
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light'
}

export function applyThemeMeta(preference: ThemePreference): void {
  if (typeof document === 'undefined') {
    return
  }
  const content = preference === 'system' ? 'light dark' : preference
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'color-scheme'
    document.head.appendChild(meta)
  }
  if (meta.content !== content) {
    meta.content = content
  }
}

export function subscribeSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY)
  const handleChange = (event: MediaQueryListEvent) => {
    onChange(event.matches ? 'dark' : 'light')
  }
  mediaQuery.addEventListener('change', handleChange)
  return () => {
    mediaQuery.removeEventListener('change', handleChange)
  }
}

export function subscribeThemeStorage(onChange: (preference: ThemePreference) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) {
      return
    }
    onChange(parseThemePreference(event.newValue))
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    window.removeEventListener('storage', handleStorage)
  }
}
