const ZOOM_STORAGE_KEY = 'bwf-desktop-zoom-factor'
const MIN_ZOOM_FACTOR = 0.5
const MAX_ZOOM_FACTOR = 3.0

export type DesktopZoomAction = 'in' | 'out' | 'reset'

export interface DesktopBridge {
  getZoomFactor: () => Promise<number>
  zoom: (action: DesktopZoomAction) => Promise<number>
  setZoomFactor: (factor: number) => Promise<number>
  onZoomChanged: (callback: (factor: number) => void) => () => void
}

declare global {
  interface Window {
    bwfDesktop?: DesktopBridge
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined' || !window.bwfDesktop) {
    return null
  }
  return window.bwfDesktop
}

export function clampDesktopZoomFactor(factor: number): number {
  if (!Number.isFinite(factor)) {
    return 1
  }
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, Math.round(factor * 100) / 100))
}

export function loadSavedZoomFactor(): number | null {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed) || parsed < MIN_ZOOM_FACTOR || parsed > MAX_ZOOM_FACTOR) {
      return null
    }
    return clampDesktopZoomFactor(parsed)
  } catch {
    return null
  }
}

export function saveZoomFactor(factor: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clampDesktopZoomFactor(factor)))
  } catch {
    // Ignore storage errors in restricted environments.
  }
}
