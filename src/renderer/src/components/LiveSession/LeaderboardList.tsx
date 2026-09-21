import type { CSSProperties } from 'react'
import type { LeaderboardEntry } from '../../lib/liveSession/leaderboard'

interface LeaderboardListProps {
  entries: LeaderboardEntry[]
  /** Between-question reveals use the plain numbered list; the final end-of-session leaderboard
   *  uses `podium` for real visual weight on the top 3 — same data, different treatment for the
   *  moment that actually matters. */
  podium?: boolean
}

/** Shared by HostControlView and GuestSessionView so the two never render standings differently. */
export function LeaderboardList({ entries, podium = false }: LeaderboardListProps): JSX.Element {
  if (entries.length === 0) {
    return <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)', margin: 0 }}>No scores yet.</p>
  }

  if (!podium) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map((entry, i) => (
          <div key={entry.userId} style={plainRowStyle}>
            <span>
              {i + 1}. {entry.displayName}
            </span>
            <span style={{ fontWeight: 600 }}>{entry.totalPoints}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map((entry, i) => {
        const rank = i + 1
        const medalColor = rank === 1 ? '#C9A227' : rank === 2 ? '#9AA3AB' : rank === 3 ? '#B0743F' : null
        return (
          <div
            key={entry.userId}
            style={{
              ...podiumRowStyle,
              ...(rank === 1 ? podiumFirstStyle : rank <= 3 ? podiumTopThreeStyle : {})
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={medalSlotStyle}>
                {medalColor ? (
                  <span style={{ ...medalBadgeStyle, background: medalColor }}>{rank}</span>
                ) : (
                  rank
                )}
              </span>
              {entry.displayName}
            </span>
            <span style={{ fontWeight: 700 }}>{entry.totalPoints}</span>
          </div>
        )
      })}
    </div>
  )
}

const plainRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 'var(--font-sm)'
}

const podiumRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  fontSize: 'var(--font-sm)'
}

const podiumFirstStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontSize: 'var(--font-lg)',
  fontWeight: 700,
  padding: '12px 14px'
}

const podiumTopThreeStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 'var(--font-md)'
}

const medalSlotStyle: CSSProperties = {
  display: 'inline-flex',
  width: 22,
  justifyContent: 'center'
}

/** Ranks 1-3 get a small solid disc in gold/silver/bronze instead of a medal emoji — same meaning,
 *  but it recolours crisply and renders identically on every OS. */
const medalBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.5em',
  height: '1.5em',
  borderRadius: '50%',
  color: '#fff',
  fontSize: '0.8em',
  fontWeight: 700
}
