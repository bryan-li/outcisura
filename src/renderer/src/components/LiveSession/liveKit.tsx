import type { CSSProperties, ReactNode } from 'react'
import { QUESTION_SECONDS_PRESETS } from '../../lib/liveSession/constants'
import { glassCardStyle } from '../dashboardKit'
import { Icon } from '../Icon'

/** The shared look of every live-session screen — host lobby, host control, and the player view a
 *  guest sees. One floating glass card on a centred stage, pill controls, accent-tinted eyebrows:
 *  the same shapes as the sidebar and the marketing site, rather than the plain bordered boxes
 *  these screens used to be. */

export const stageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-4)',
  minHeight: '100%',
  width: '100%'
}

export const sessionCardStyle: CSSProperties = {
  ...glassCardStyle,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  width: 420,
  maxWidth: '100%',
  padding: 'var(--space-5)',
  animation: 'scale-in 200ms ease'
}

/** A small uppercase caption, optionally tinted like the site's hero eyebrow pill. */
export function Eyebrow({ children, tinted = false }: { children: ReactNode; tinted?: boolean }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 'var(--font-xs)',
        fontWeight: 600,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: tinted ? 'var(--accent)' : 'var(--fg-faint)',
        ...(tinted
          ? { background: 'var(--accent-soft)', borderRadius: 'var(--radius-pill)', padding: '4px 10px', alignSelf: 'flex-start' }
          : {})
      }}
    >
      {children}
    </span>
  )
}

/** The solid-orange call to action, matching the sidebar's active pill (lit top edge, faint ring,
 *  soft accent glow) — same treatment as .btn-primary on the site. */
export const pillPrimaryStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontWeight: 600,
  fontSize: 'var(--font-md)',
  borderRadius: 'var(--radius-pill)',
  padding: '11px 22px',
  cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 #ffffff73, inset 0 0 0 1px #ffffff2e, 0 2px 8px color-mix(in srgb, var(--accent) 45%, transparent)'
}

export const pillSecondaryStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: 'var(--font-sm)',
  borderRadius: 'var(--radius-pill)',
  padding: '8px 16px',
  cursor: 'pointer'
}

export const pillQuietStyle: CSSProperties = {
  ...pillSecondaryStyle,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 'var(--font-xs)',
  padding: '6px 12px'
}

export const inputPillStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 'var(--font-md)',
  padding: '11px 16px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-row)',
  background: 'var(--bg)',
  color: 'inherit',
  outline: 'none'
}

/**
 * The host's per-question answering window. Presets in a segmented pill rather than a number field:
 * it gets used mid-game in front of a room, so it has to be one tap and legible from a distance.
 */
export function TimeLimitPicker({
  seconds,
  onChange,
  hint
}: {
  seconds: number
  onChange: (seconds: number) => void
  hint?: string
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <Eyebrow>
          <Icon name="timer" size="1em" />Time per question
        </Eyebrow>
        {hint && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>{hint}</span>}
      </div>
      <div role="radiogroup" aria-label="Time per question" style={segmentedTrackStyle}>
        {QUESTION_SECONDS_PRESETS.map((preset) => {
          const active = preset === seconds
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(preset)}
              style={{
                ...segmentStyle,
                ...(active ? segmentActiveStyle : {})
              }}
            >
              {preset}s
            </button>
          )
        })}
      </div>
    </div>
  )
}

const segmentedTrackStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: 3,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)'
}

const segmentStyle: CSSProperties = {
  flex: 1,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 'var(--font-sm)',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  borderRadius: 'var(--radius-pill)',
  padding: '6px 0',
  cursor: 'pointer'
}

const segmentActiveStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  boxShadow: 'inset 0 1px 0 #ffffff73, inset 0 0 0 1px #ffffff2e, 0 1px 3px color-mix(in srgb, var(--accent) 45%, transparent)'
}

/**
 * The countdown, drawn as a ring that drains over the question's full window so a glance tells you
 * how much is left without reading the number. Goes red for the last five seconds. `total` is the
 * window the ring is scaled against — when the host re-times a live question it changes underneath,
 * which is exactly right: the ring is "how much of what you've been given is left".
 */
export function CountdownRing({ remaining, total, size = 76 }: { remaining: number; total: number; size?: number }): JSX.Element {
  const radius = size / 2 - 5
  const circumference = 2 * Math.PI * radius
  const fraction = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0
  const urgent = remaining <= 5
  const color = urgent ? 'var(--danger)' : 'var(--accent)'

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ display: 'block', transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{ transition: 'stroke-dashoffset 250ms linear, stroke 200ms ease' }}
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size > 60 ? 'var(--font-xl)' : 'var(--font-lg)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          color
        }}
        aria-label={`${remaining} seconds remaining`}
      >
        {remaining}
      </span>
    </div>
  )
}

/**
 * Who has answered so far — one dot per player, filling as answers land. Makes the auto-reveal
 * legible: when the last dot fills, the question closes on its own (see HostControlView), so the
 * host can see it coming instead of it just happening.
 */
export function AnsweredDots({ answered, total }: { answered: number; total: number }): JSX.Element {
  const complete = total > 0 && answered >= total
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 'var(--font-sm)', color: complete ? 'var(--accent)' : 'var(--fg-muted)', fontWeight: complete ? 600 : 400 }}>
        {complete ? 'Everyone answered' : `${answered} / ${total || '?'} answered`}
      </span>
      {total > 0 && total <= 24 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: i < answered ? 'var(--accent)' : 'var(--border)',
                transition: 'background-color 200ms ease'
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--border)', overflow: 'hidden', minWidth: 120 }}>
          <div
            style={{
              height: '100%',
              width: `${total > 0 ? Math.min(100, (answered / total) * 100) : 0}%`,
              background: 'var(--accent)',
              transition: 'width 250ms ease'
            }}
          />
        </div>
      )}
    </div>
  )
}

/** The question itself, shown identically to host and player. */
export function QuestionText({ children }: { children: ReactNode }): JSX.Element {
  return <p style={{ fontSize: 'var(--font-xl)', fontWeight: 600, margin: 0, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{children}</p>
}

export const optionPillStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  textAlign: 'left',
  fontSize: 'var(--font-md)',
  padding: '12px 16px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-row)',
  background: 'var(--bg)',
  color: 'inherit',
  cursor: 'pointer'
}

export const optionPillSelectedStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600
}

/** The A/B/C/D marker on an option row — solid accent once that option is picked. */
export function OptionLetter({ index, selected }: { index: number; selected: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        flexShrink: 0,
        borderRadius: 'var(--radius-pill)',
        fontSize: 'var(--font-xs)',
        fontWeight: 700,
        background: selected ? 'var(--accent)' : 'var(--bg-sidebar)',
        color: selected ? 'var(--on-accent)' : 'var(--fg-faint)',
        border: selected ? 'none' : '1px solid var(--border)'
      }}
    >
      {String.fromCharCode(65 + index)}
    </span>
  )
}

/** "⏎ Enter to submit"-style keyboard hints, in the same quiet voice as the slide finder's footer. */
export function KeyHint({ children }: { children: ReactNode }): JSX.Element {
  return <p style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', margin: 0, textAlign: 'center' }}>{children}</p>
}
