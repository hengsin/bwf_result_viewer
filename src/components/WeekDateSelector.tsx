import type { WeekDayOption } from '../lib/time'

interface WeekDateSelectorProps {
  days: WeekDayOption[]
  selectedDate: string | null
  onSelectDate: (isoDate: string) => void
}

export function WeekDateSelector({ days, selectedDate, onSelectDate }: WeekDateSelectorProps) {
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  const rangeLabel = firstDay && lastDay ? `${firstDay.isoDate} – ${lastDay.isoDate}` : ''

  return (
    <fieldset className="control-row week-selector">
      <legend className="control-label week-selector-legend">
        <span>Current week (Monday – Sunday)</span>
        {rangeLabel ? <span className="week-range-label">{rangeLabel}</span> : null}
      </legend>

      <div className="week-day-grid" role="group" aria-label="Select a date from the current week">
        {days.map((day) => {
          const isSelected = selectedDate === day.isoDate
          return (
            <button
              key={day.isoDate}
              type="button"
              className={`week-day-btn${isSelected ? ' is-active' : ''}${day.isToday ? ' is-today' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelectDate(day.isoDate)}
            >
              <span className="week-day-top">
                <span className="week-day-name">{day.weekdayShort}</span>
                {day.isToday ? <span className="week-today-badge">Today</span> : null}
              </span>
              <span className="week-day-date">{day.isoDate}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
