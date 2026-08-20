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
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
        return (
          <div
            key={entry.userId}
            style={{
              ...podiumRowStyle,
              ...(rank === 1 ? podiumFirstStyle : rank <= 3 ? podiumTopThreeStyle : {})
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={medalSlotStyle}>{medal ?? rank}</span>
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
