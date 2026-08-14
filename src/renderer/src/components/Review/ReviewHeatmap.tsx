import type { CSSProperties } from 'react'
import type { ReviewLogEntry } from '../../../../shared/types'
import { computeReviewHeatmap } from '../../utils/reviewStats'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CELL_SIZE = 11
const CELL_GAP = 3

/** 0 = no reviews, 1–4 scale relative to the busiest day in the window — GitHub's own buckets
 *  (1, 2-4, 5-8, 9+) assume commit-sized daily volumes, which don't fit a flashcard app's much
 *  smaller review counts, so we scale to whatever the user's own data actually spans instead. */
function levelFor(count: number, maxCount: number): number {
  if (count === 0) return 0
  if (maxCount <= 1) return 4
  const step = maxCount / 4
  return Math.min(4, Math.ceil(count / step))
}

function levelColor(level: number): string {
  if (level === 0) return 'var(--bg-hover)'
  return `color-mix(in srgb, var(--accent) ${level * 25}%, var(--bg))`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ReviewHeatmap({ log, now }: { log: ReviewLogEntry[]; now: Date }): JSX.Element {
  const weeks = computeReviewHeatmap(log, now, 53)
  const maxCount = Math.max(0, ...weeks.flat().map((d) => d.count))

  // A month label goes above the first week whose days roll into a new month, so it lines up
  // with the column where that month actually starts (not just "week index / 53").
  let lastMonth = -1
  const monthLabels = weeks.map((week) => {
    const month = week[0].date.getMonth()
    if (month !== lastMonth) {
      lastMonth = month
      return MONTH_NAMES[month]
    }
    return ''
  })

  return (
    // Deliberately no overflow-x here — setting it to anything but `visible` forces overflow-y to
    // compute as `auto` too (CSS overflow spec), which would clip the per-cell tooltips below
    // since they're positioned above their cell via `bottom: 100%`. The grid (~758px) comfortably
    // fits this page's content width, so horizontal scroll isn't needed in practice.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${weeks.length}, ${CELL_SIZE}px)`,
          gap: CELL_GAP,
          fontSize: 'var(--font-xs)',
          color: 'var(--fg-faint)',
          width: 'fit-content'
        }}
      >
        {monthLabels.map((label, i) => (
          <span key={i} style={{ overflow: 'visible', whiteSpace: 'nowrap' }}>
            {label}
          </span>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateRows: `repeat(7, ${CELL_SIZE}px)`,
          gridAutoFlow: 'column',
          gap: CELL_GAP,
          width: 'fit-content'
        }}
      >
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => (
            <div
              key={`${wi}-${di}`}
              className="heatmap-cell"
              style={cellStyle(levelColor(levelFor(day.count, maxCount)))}
            >
              <span className="heatmap-tooltip">
                {day.count} review{day.count === 1 ? '' : 's'} on {formatDate(day.date)}
              </span>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div key={level} style={cellStyle(levelColor(level))} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

function cellStyle(background: string): CSSProperties {
  return {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 2,
    background
  }
}
