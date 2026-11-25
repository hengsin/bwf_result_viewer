const formatterCache = new Map<string, Intl.DateTimeFormat>()

interface ZonedDateParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

function formatterFor(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`
  const cached = formatterCache.get(key)
  if (cached) {
    return cached
  }
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, ...options })
  formatterCache.set(key, formatter)
  return formatter
}

export function isValidTimeZone(timeZone: string): boolean {
  const trimmed = timeZone.trim()
  if (!trimmed) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed })
    return true
  } catch {
    return false
  }
}

export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function getZonedParts(instant: Date, timeZone: string): ZonedDateParts {
  const formatter = formatterFor(timeZone, {
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(instant)
  const read = (type: string): number => {
    const part = parts.find((p) => p.type === type)
    const value = Number(part?.value ?? 0)
    return Number.isNaN(value) ? 0 : value
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

/** Offset of `timeZone` at the given instant, in milliseconds east of UTC. */
export function getTimeZoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = getZonedParts(instant, timeZone)
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUTC - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * Turns wall-clock components (interpreted in `sourceTimeZone`) into the
 * corresponding point in time. Returns the instant as a Date.
 */
export function sourceWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  sourceTimeZone: string,
): Date {
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstGuess = asUTC - getTimeZoneOffsetMs(sourceTimeZone, new Date(asUTC))
  const refinedOffsetMs = getTimeZoneOffsetMs(sourceTimeZone, new Date(firstGuess))
  return new Date(asUTC - refinedOffsetMs)
}

export function formatInTimeZone(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return formatterFor(timeZone, options).format(instant)
}

/** Formats a time of day (hour + minute) in the given timezone, e.g. "10:00 AM". */
export function formatTimeOfDay(instant: Date, timeZone?: string): string {
  return formatterFor(timeZone ?? getBrowserTimeZone(), {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }).format(instant)
}

/** Formats a full date (weekday, long month, day, year) in the given timezone. */
export function formatLongDate(instant: Date, timeZone?: string): string {
  return formatterFor(timeZone ?? getBrowserTimeZone(), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(instant)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

interface TemporalPlainDateLike {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly dayOfWeek: number
  add(duration: { days: number }): TemporalPlainDateLike
  subtract(duration: { days: number }): TemporalPlainDateLike
  toString(): string
}

interface TemporalGlobalLike {
  PlainDate?: {
    from(item: string, options?: { overflow?: 'constrain' | 'reject' }): TemporalPlainDateLike
  }
  Now?: {
    plainDateISO(): TemporalPlainDateLike
  }
}

function getTemporalApi(): TemporalGlobalLike | null {
  const candidate = (globalThis as { Temporal?: TemporalGlobalLike }).Temporal
  if (candidate?.PlainDate && candidate?.Now) {
    return candidate
  }
  return null
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

/** Returns true when `value` is a valid calendar date in strict `YYYY-MM-DD` format. */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return false
  }
  const temporal = getTemporalApi()
  if (temporal?.PlainDate) {
    try {
      temporal.PlainDate.from(value, { overflow: 'reject' })
      return true
    } catch {
      return false
    }
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const check = new Date(Date.UTC(year, month - 1, day))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
}

/** Returns today's calendar date in the viewer's local timezone as `YYYY-MM-DD`. */
export function getTodayIsoDate(): string {
  const temporal = getTemporalApi()
  if (temporal?.Now) {
    return temporal.Now.plainDateISO().toString()
  }
  const now = new Date()
  return formatIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

const MONTH_LONG_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })

/** Returns the current local calendar year and English month name (e.g. `November` / `NOVEMBER`). */
export function getCurrentYearAndMonth(): { year: number; monthLabel: string; monthNameUpper: string } {
  const temporal = getTemporalApi()
  let year: number
  let month: number
  if (temporal?.Now) {
    const today = temporal.Now.plainDateISO()
    year = today.year
    month = today.month
  } else {
    const now = new Date()
    year = now.getFullYear()
    month = now.getMonth() + 1
  }
  const monthLabel = MONTH_LONG_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)))
  return {
    year,
    monthLabel,
    monthNameUpper: monthLabel.toUpperCase(),
  }
}

export interface WeekDayOption {
  isoDate: string
  weekdayShort: string
  weekdayLong: string
  shortDateLabel: string
  isToday: boolean
}

const WEEKDAY_SHORT_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const WEEKDAY_LONG_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function buildWeekDayOption(year: number, month: number, day: number, todayIso: string): WeekDayOption {
  const isoDate = formatIsoDate(year, month, day)
  const utcCalendarDate = new Date(Date.UTC(year, month - 1, day))
  return {
    isoDate,
    weekdayShort: WEEKDAY_SHORT_FORMATTER.format(utcCalendarDate),
    weekdayLong: WEEKDAY_LONG_FORMATTER.format(utcCalendarDate),
    shortDateLabel: SHORT_DATE_FORMATTER.format(utcCalendarDate),
    isToday: isoDate === todayIso,
  }
}

/** Returns the 7 calendar days (Monday to Sunday) of the current week in the viewer's local calendar. */
export function getCurrentWeekDays(): WeekDayOption[] {
  const temporal = getTemporalApi()
  if (temporal?.Now) {
    const today = temporal.Now.plainDateISO()
    const todayIso = today.toString()
    const monday = today.subtract({ days: today.dayOfWeek - 1 })
    return Array.from({ length: 7 }, (_, index) => {
      const current = monday.add({ days: index })
      return buildWeekDayOption(current.year, current.month, current.day, todayIso)
    })
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const todayIso = formatIsoDate(year, month, day)
  const jsDay = now.getDay()
  const isoDayOfWeek = jsDay === 0 ? 7 : jsDay
  const mondayOffset = -(isoDayOfWeek - 1)

  return Array.from({ length: 7 }, (_, index) => {
    const utc = new Date(Date.UTC(year, month - 1, day + mondayOffset + index))
    return buildWeekDayOption(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), todayIso)
  })
}

interface ContextDateParts {
  year: number
  month: number
  day: number
}

function contextDateParts(contextDate: string): ContextDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(contextDate)
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

/** "2026-10-29 10:00:00" -> "2026-10-29 20:00:00" (values re-expressed in the viewer's local timezone) */
const FULL_DATETIME_PATTERN = /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/g

/** "10:00 AM" / "3:00PM" -> converted time of day in the viewer's local timezone */
const MERIDIEM_TIME_PATTERN = /(\d{1,2}):(\d{2})\s*([AaPp])\.?\s*([Mm])\.?/g

/**
 * Converts time expressions found in free text from a source timezone
 * (e.g. the venue timezone used by the BWF site) into the viewer's local timezone.
 */
export function convertTimeText(text: string, sourceTimeZone: string, contextDate: string): string {
  const localTz = getBrowserTimeZone()

  const withFullDatetimes = text.replace(
    FULL_DATETIME_PATTERN,
    (_match, year, month, day, hour, minute, second) => {
      const instant = sourceWallTimeToInstant(
        Number(year),
        Number(month),
        Number(day),
        Number(hour),
        Number(minute),
        second ? Number(second) : 0,
        sourceTimeZone,
      )
      const parts = getZonedParts(instant, localTz)
      const seconds = parts.second > 0 ? `:${pad(parts.second)}` : ''
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}${seconds}`
    },
  )

  return withFullDatetimes.replace(
    MERIDIEM_TIME_PATTERN,
    (_match, hour, minute, meridiemInitial, meridiemM, _meridiemDot) => {
      const meridiem = `${meridiemInitial ?? ''}${meridiemM ?? ''}`.toUpperCase()
      const minutes = (Number(hour) % 12) * 60 + Number(minute) + (meridiem === 'PM' ? 12 * 60 : 0)
      const context = contextDateParts(contextDate)
      const instant = sourceWallTimeToInstant(
        context.year,
        context.month,
        context.day,
        Math.floor(minutes / 60),
        minutes % 60,
        0,
        sourceTimeZone,
      )
      const parts = getZonedParts(instant, localTz)
      const displayHour = parts.hour % 12 === 0 ? 12 : parts.hour % 12
      const displayMeridiem = parts.hour >= 12 ? 'PM' : 'AM'
      return `${displayHour}:${pad(parts.minute)} ${displayMeridiem}`
    },
  )
}
