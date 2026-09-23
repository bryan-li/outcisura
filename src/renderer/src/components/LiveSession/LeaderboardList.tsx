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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.map((entry, i) => (
          <div key={entry.userId} style={plainRowStyle}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={rankChipStyle}>{i + 1}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.displayName}</span>
            </span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{entry.totalPoints}</span>
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
                  // On the solid-accent first place, the gold disc would sit orange-on-orange — it
                  // gets the site's dark translucent badge treatment instead.
                  <span
                    style={
                      rank === 1
                        ? { ...medalBadgeStyle, background: '#1d110033', color: 'var(--on-accent)' }
                        : { ...medalBadgeStyle, background: medalColor }
                    }
                  >
                    {rank}
                  </span>
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
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-2)',
  fontSize: 'var(--font-sm)',
  padding: '6px 10px',
  borderRadius: 'var(--radius-row)'
}

/** The position number as a small neutral disc, so names line up however long the list gets. */
const rankChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  flexShrink: 0,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)',
  color: 'var(--fg-faint)',
  fontSize: 'var(--font-xs)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums'
}

const podiumRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderRadius: 'var(--radius-row)',
  border: '1px solid var(--border)',
  fontSize: 'var(--font-sm)'
}

/** First place gets the solid accent pill — the same lit fill as the sidebar's current page — so the
 *  winner reads as the one thing on the screen, not as another row with a tint. */
const podiumFirstStyle: CSSProperties = {
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  boxShadow: 'inset 0 1px 0 #ffffff73, inset 0 0 0 1px #ffffff2e, 0 2px 10px color-mix(in srgb, var(--accent) 45%, transparent)',
  fontSize: 'var(--font-lg)',
  fontWeight: 700,
  padding: '14px 16px',
  borderRadius: 'var(--radius-panel)'
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
