import { useEffect, useId, useRef } from 'react'
import type { MatchStartNotification } from '../lib/schedule'

interface NotificationToastsProps {
  toasts: MatchStartNotification[]
  onDismiss: (id: string) => void
  onDismissAll: () => void
  onJumpToMatch: (anchorId: string) => void
}

interface DocumentWithAriaNotify extends Document {
  ariaNotify?: (message: string, options?: { priority?: 'normal' | 'high' }) => void
}

/**
 * Persistent top-layer toast notifications using popover="manual" with graceful fallback,
 * screen reader announcement (ariaNotify with polite live-region fallback), and focus restoration.
 */
export function NotificationToasts({
  toasts,
  onDismiss,
  onDismissAll,
  onJumpToMatch,
}: NotificationToastsProps) {
  const trayId = useId()
  const trayRef = useRef<HTMLDivElement | null>(null)
  const liveRegionRef = useRef<HTMLDivElement | null>(null)
  const lastFocusedBeforeToastRef = useRef<HTMLElement | null>(null)
  const announcedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && trayRef.current && !trayRef.current.contains(target)) {
        lastFocusedBeforeToastRef.current = target
      }
    }
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [])

  useEffect(() => {
    const tray = trayRef.current
    if (!tray) {
      return
    }
    const supportsPopover =
      typeof HTMLElement !== 'undefined' &&
      Object.hasOwn(HTMLElement.prototype, 'popover') &&
      typeof tray.showPopover === 'function'

    if (toasts.length > 0) {
      if (supportsPopover) {
        if (!tray.matches(':popover-open')) {
          try {
            tray.showPopover()
          } catch {
            tray.classList.add(':popover-open')
          }
        }
      } else {
        tray.classList.add(':popover-open')
      }
    } else if (supportsPopover) {
      if (tray.matches(':popover-open')) {
        try {
          tray.hidePopover()
        } catch {
          // Ignore if already hidden.
        }
      }
      tray.classList.remove(':popover-open')
    } else {
      tray.classList.remove(':popover-open')
    }
  }, [toasts.length])

  useEffect(() => {
    const newlyAdded = toasts.filter((toast) => !announcedIdsRef.current.has(toast.id))
    if (newlyAdded.length === 0) {
      return
    }
    const latest = newlyAdded[newlyAdded.length - 1]
    for (const toast of newlyAdded) {
      announcedIdsRef.current.add(toast.id)
    }
    const announcementText = `${latest.title}. ${latest.body} Actions available`
    const docWithNotify = document as DocumentWithAriaNotify
    if (typeof docWithNotify.ariaNotify === 'function') {
      docWithNotify.ariaNotify(announcementText, { priority: 'normal' })
    } else if (liveRegionRef.current) {
      liveRegionRef.current.textContent = ''
      const timerId = window.setTimeout(() => {
        if (liveRegionRef.current) {
          liveRegionRef.current.textContent = announcementText
        }
      }, 40)
      return () => window.clearTimeout(timerId)
    }
  }, [toasts])

  const handleDismiss = (id: string, index: number) => {
    const tray = trayRef.current
    const wasFocusInside = Boolean(tray && document.activeElement && tray.contains(document.activeElement))
    const remainingCount = toasts.length - 1
    onDismiss(id)

    if (!wasFocusInside) {
      return
    }
    window.requestAnimationFrame(() => {
      if (remainingCount > 0 && trayRef.current) {
        const closeButtons = trayRef.current.querySelectorAll<HTMLButtonElement>('[data-toast-close]')
        const nextBtn = closeButtons[Math.min(index, closeButtons.length - 1)]
        nextBtn?.focus()
      } else if (lastFocusedBeforeToastRef.current?.isConnected) {
        lastFocusedBeforeToastRef.current.focus()
      }
    })
  }

  const handleDismissAll = () => {
    const tray = trayRef.current
    const wasFocusInside = Boolean(tray && document.activeElement && tray.contains(document.activeElement))
    onDismissAll()
    if (wasFocusInside && lastFocusedBeforeToastRef.current?.isConnected) {
      window.requestAnimationFrame(() => {
        lastFocusedBeforeToastRef.current?.focus()
      })
    }
  }

  return (
    <>
      <p className="visually-hidden">Match alert announcements</p>
      <div ref={liveRegionRef} className="visually-hidden" aria-live="polite" aria-atomic="true" />

      <div
        id={trayId}
        ref={trayRef}
        role="region"
        aria-label="Match notifications"
        className="toast-tray"
        {...({ popover: 'manual' } as Record<string, string>)}
      >
        {toasts.length > 1 ? (
          <div className="toast-tray-header">
            <span className="toast-tray-count">{toasts.length} match alerts</span>
            <button
              type="button"
              className="toast-clear-all"
              onClick={handleDismissAll}
              {...({ popovertarget: trayId, popovertargetaction: 'hide' } as Record<string, string>)}
            >
              Dismiss all
            </button>
          </div>
        ) : null}

        {toasts.map((toast, index) => (
          <div className="toast-card" key={toast.id} data-toast-reason={toast.reason}>
            <div className="toast-accent" aria-hidden="true" />
            <div className="toast-body">
              <div className="toast-title">{toast.title}</div>
              <p className="toast-message">{toast.body}</p>
              <div className="toast-actions">
                <button
                  type="button"
                  className="toast-action-btn"
                  onClick={() => onJumpToMatch(toast.anchorId)}
                >
                  View match
                </button>
              </div>
            </div>
            <button
              type="button"
              className="toast-close-btn"
              data-toast-close="true"
              aria-label={`Close alert: ${toast.title}`}
              onClick={() => handleDismiss(toast.id, index)}
              {...(toasts.length === 1
                ? ({ popovertarget: trayId, popovertargetaction: 'hide' } as Record<string, string>)
                : {})}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
