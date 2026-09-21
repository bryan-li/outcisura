import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useAuthStore } from '../../state/authStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useUiStore } from '../../state/uiStore'
import { markIntroSeen, useOnboardingStore } from '../../state/onboardingStore'
import { importSampleDeck } from '../../lib/sampleDeck'
import { Icon } from '../Icon'
import { primaryPillStyle, secondaryPillStyle } from '../dashboardKit'

interface Step {
  title: string
  body: string
  art: () => JSX.Element
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Outcisura',
    body: 'Turn the slides, PDFs and lectures you already study from into flashcards you actually remember. Here is a 30-second tour.',
    art: WelcomeArt
  },
  {
    title: 'Bring in your material',
    body: 'Import PowerPoints, PDFs or videos into your Library. Everything stays on your device, and your cards can sync across your devices.',
    art: ImportArt
  },
  {
    title: 'Capture, don’t retype',
    body: 'Drag a box around text or a diagram and make a card in one click. Each card links back to the exact slide it came from.',
    art: CaptureArt
  },
  {
    title: 'Review at the right moment',
    body: 'Spaced repetition brings each card back just before you would forget it. Rate it, and the next review is scheduled for you.',
    art: ReviewArt
  },
  {
    title: 'Keep it organized',
    body: 'Sort cards into folders, tag them, and explore how everything connects in the Graph. Search anything with Cmd+K.',
    art: OrganizeArt
  },
  {
    title: 'Study together',
    body: 'Let AI polish your cards, then host a live quiz that friends join with a code. You can export to Anki anytime.',
    art: LiveArt
  },
  {
    title: 'You’re all set',
    body: 'We added a short sample deck to your Library so you can try capturing a card right away.',
    art: ReadyArt
  }
]

/** First-run walkthrough. Mounted once in AppShell; visible whenever onboardingStore.open is true
 *  (automatically for brand-new accounts, or from Settings’ debug button). */
export function IntroTour(): JSX.Element | null {
  const open = useOnboardingStore((s) => s.open)
  const close = useOnboardingStore((s) => s.close)
  const userId = useAuthStore((s) => s.session?.user.id)
  const setView = useUiStore((s) => s.setView)
  const openDocument = useDocumentsStore((s) => s.openDocument)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setStep(0)
      dialogRef.current?.focus()
    }
  }, [open])

  const last = step === STEPS.length - 1

  // The last step promises a sample deck, so make sure it's there by then (idempotent).
  useEffect(() => {
    if (open && last) void importSampleDeck()
  }, [open, last])

  function finish(): void {
    if (userId) markIntroSeen(userId)
    close()
  }

  async function finishAndOpenSample(): Promise<void> {
    setBusy(true)
    const id = await importSampleDeck()
    setBusy(false)
    finish()
    if (id) {
      setView({ type: 'library' })
      await openDocument(id)
    }
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(STEPS.length - 1, s + 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId])

  if (!open) return null

  const current = STEPS[step]
  const Art = current.art

  return (
    <div style={backdropStyle} className="tour-backdrop">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Welcome tour" style={dialogStyle} className="tour-dialog">
        <div style={stageStyle}>
          <div key={step} className="tour-art" style={{ width: '100%', height: '100%' }}>
            <Art />
          </div>
        </div>
        <div key={`t${step}`} className="tour-text" style={{ padding: '0 var(--space-5)', minHeight: 116 }}>
          <h2 style={{ fontSize: 'var(--font-xl)', margin: 0, letterSpacing: '-0.02em' }}>{current.title}</h2>
          <p style={{ color: 'var(--fg-muted)', margin: 'var(--space-2) 0 0', lineHeight: 1.5 }}>{current.body}</p>
        </div>
        <div style={footerStyle}>
          <div style={{ display: 'flex', gap: 6 }} aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} style={{ ...dotStyle, width: i === step ? 18 : 6, background: i === step ? 'var(--accent)' : 'var(--border)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {!last && (
              <button onClick={finish} style={skipStyle}>
                Skip
              </button>
            )}
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} style={secondaryPillStyle} aria-label="Back">
                <Icon name="arrow-left" bare size={14} />
              </button>
            )}
            {last ? (
              <>
                <button onClick={finish} style={secondaryPillStyle}>
                  Close
                </button>
                <button onClick={() => void finishAndOpenSample()} disabled={busy} style={primaryPillStyle}>
                  {busy ? 'Adding sample…' : 'Open sample deck'}
                </button>
              </>
            ) : (
              <button onClick={() => setStep(step + 1)} style={primaryPillStyle}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- illustrations: small looping CSS/SVG scenes, restarted per step via key ---------- */

function Frame({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ position: 'relative', width: '100%', height: '100%' }}>{children}</div>
}

function WelcomeArt(): JSX.Element {
  return (
    <Frame>
      {[0, 1, 2].map((i) => (
        <span key={i} className="tour-ring" style={{ animationDelay: `${i * 0.8}s` }} />
      ))}
      <div className="tour-pop" style={{ ...centerStyle, color: 'var(--accent)' }}>
        <Icon name="sparkles" bare size={56} />
      </div>
    </Frame>
  )
}

function ImportArt(): JSX.Element {
  const files = [
    { icon: 'presentation', left: '18%', delay: 0 },
    { icon: 'file-text', left: '42%', delay: 0.35 },
    { icon: 'video', left: '66%', delay: 0.7 }
  ] as const
  return (
    <Frame>
      {files.map((f) => (
        <div key={f.icon} className="tour-drop" style={{ ...fileChipStyle, left: f.left, animationDelay: `${f.delay}s` }}>
          <Icon name={f.icon} bare size={22} />
        </div>
      ))}
      <div style={trayStyle}>
        <Icon name="layers" bare size={16} /> Library
      </div>
    </Frame>
  )
}

function CaptureArt(): JSX.Element {
  return (
    <Frame>
      <div style={slideMockStyle}>
        <span style={{ ...lineStyle, width: '55%', height: 8, background: 'var(--fg-muted)' }} />
        <span style={{ ...lineStyle, width: '85%' }} />
        <span style={{ ...lineStyle, width: '70%' }} />
        <span className="tour-select" style={selectionStyle} />
      </div>
      <div className="tour-card-in" style={miniCardStyle}>
        <span style={{ ...lineStyle, width: '60%', height: 7, background: 'var(--accent)' }} />
        <span style={{ ...lineStyle, width: '90%' }} />
        <span style={{ ...lineStyle, width: '45%' }} />
      </div>
    </Frame>
  )
}

function ReviewArt(): JSX.Element {
  const ratings = ['Again', 'Hard', 'Good', 'Easy']
  return (
    <Frame>
      <div style={{ ...centerStyle, top: '42%', perspective: 600 }}>
        <div className="tour-flip" style={flipCardStyle}>
          <div style={{ ...faceStyle }}>What is spaced repetition?</div>
          <div style={{ ...faceStyle, transform: 'rotateY(180deg)', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            Reviews timed just before you forget
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
        {ratings.map((r, i) => (
          <span key={r} className="tour-rate" style={{ ...ratePillStyle, animationDelay: `${i * 0.5}s` }}>
            {r}
          </span>
        ))}
      </div>
    </Frame>
  )
}

function OrganizeArt(): JSX.Element {
  const nodes = [
    { x: 160, y: 100, r: 13, c: 'var(--accent)' },
    { x: 80, y: 55, r: 8, c: 'hsl(210 60% 55%)' },
    { x: 240, y: 50, r: 8, c: 'hsl(150 45% 45%)' },
    { x: 70, y: 150, r: 8, c: 'hsl(280 45% 60%)' },
    { x: 250, y: 150, r: 8, c: 'hsl(30 70% 55%)' },
    { x: 160, y: 30, r: 6, c: 'var(--fg-faint)' }
  ]
  return (
    <Frame>
      <svg viewBox="0 0 320 190" style={{ width: '100%', height: '100%' }} aria-hidden>
        {nodes.slice(1).map((n, i) => (
          <line
            key={i}
            className="tour-edge"
            x1={nodes[0].x}
            y1={nodes[0].y}
            x2={n.x}
            y2={n.y}
            stroke="var(--fg-faint)"
            strokeWidth={1.5}
            style={{ animationDelay: `${0.2 + i * 0.12}s` }}
          />
        ))}
        {nodes.map((n, i) => (
          <circle key={i} className="tour-node" cx={n.x} cy={n.y} r={n.r} fill={n.c} style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
      </svg>
    </Frame>
  )
}

function LiveArt(): JSX.Element {
  return (
    <Frame>
      <div className="tour-pop" style={{ ...centerStyle, top: '38%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <span style={codeStyle}>K7Q2</span>
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Join code</span>
      </div>
      {[16, 34, 66, 84].map((left, i) => (
        <span key={left} className="tour-avatar" style={{ ...avatarStyle, left: `${left}%`, animationDelay: `${0.4 + i * 0.25}s`, background: AVATAR_COLORS[i] }} />
      ))}
    </Frame>
  )
}

function ReadyArt(): JSX.Element {
  return (
    <Frame>
      {Array.from({ length: 14 }).map((_, i) => (
        <span
          key={i}
          className="tour-confetti"
          style={{
            left: `${8 + ((i * 37) % 84)}%`,
            background: AVATAR_COLORS[i % 4],
            animationDelay: `${(i % 7) * 0.12}s`,
            animationDuration: `${1.6 + (i % 4) * 0.3}s`
          }}
        />
      ))}
      <div className="tour-pop" style={{ ...centerStyle, color: 'var(--accent)' }}>
        <Icon name="check-circle" bare size={60} />
      </div>
    </Frame>
  )
}

const AVATAR_COLORS = ['hsl(210 60% 60%)', 'hsl(150 45% 50%)', 'hsl(280 45% 65%)', 'hsl(30 80% 60%)']

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
  background: 'color-mix(in srgb, var(--fg) 45%, transparent)',
  backdropFilter: 'blur(6px)'
}

const dialogStyle: CSSProperties = {
  width: 'min(520px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  paddingBottom: 'var(--space-4)',
  border: '1px solid var(--border)',
  borderRadius: 24,
  background: 'var(--modal-bg)',
  boxShadow: '0 24px 70px #00000055',
  overflow: 'hidden',
  outline: 'none'
}

const stageStyle: CSSProperties = {
  height: 210,
  background: 'linear-gradient(180deg, var(--accent-soft), transparent)',
  borderBottom: '1px solid var(--border)',
  overflow: 'hidden'
}

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: '0 var(--space-5)'
}

const dotStyle: CSSProperties = { height: 6, borderRadius: 999, transition: 'width 220ms ease, background-color 220ms ease' }

const skipStyle: CSSProperties = { border: 'none', background: 'none', color: 'var(--fg-muted)', cursor: 'pointer' }

const centerStyle: CSSProperties = { position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', display: 'flex', justifyContent: 'center' }

const fileChipStyle: CSSProperties = {
  position: 'absolute',
  top: 18,
  width: 46,
  height: 54,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  color: 'var(--accent)',
  boxShadow: '0 4px 12px #0000001a'
}

const trayStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 18,
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 22px',
  borderRadius: 999,
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  fontSize: 'var(--font-sm)'
}

const slideMockStyle: CSSProperties = {
  position: 'absolute',
  left: '9%',
  top: 24,
  width: '52%',
  height: 150,
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--bg)',
  boxShadow: '0 4px 12px #0000001a'
}

const lineStyle: CSSProperties = { display: 'block', height: 6, borderRadius: 999, background: 'var(--border)' }

const selectionStyle: CSSProperties = {
  position: 'absolute',
  left: 10,
  top: 44,
  width: '80%',
  height: 42,
  border: '2px dashed var(--accent)',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)'
}

const miniCardStyle: CSSProperties = {
  position: 'absolute',
  right: '8%',
  top: 62,
  width: '28%',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  border: '1px solid var(--accent)',
  borderRadius: 12,
  background: 'var(--bg)',
  boxShadow: '0 6px 16px color-mix(in srgb, var(--accent) 25%, transparent)'
}

const flipCardStyle: CSSProperties = { position: 'relative', width: 220, height: 92, transformStyle: 'preserve-3d' }

const faceStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 12,
  fontWeight: 600,
  fontSize: 'var(--font-sm)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  background: 'var(--bg)',
  backfaceVisibility: 'hidden',
  boxShadow: '0 6px 16px #0000001a'
}

const ratePillStyle: CSSProperties = {
  padding: '4px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  fontSize: 'var(--font-xs)',
  fontWeight: 600,
  color: 'var(--fg-muted)'
}

const codeStyle: CSSProperties = {
  fontSize: 40,
  fontWeight: 700,
  letterSpacing: '0.18em',
  padding: '6px 22px',
  borderRadius: 16,
  border: '1px solid var(--accent)',
  background: 'var(--bg)',
  color: 'var(--accent)'
}

const avatarStyle: CSSProperties = { position: 'absolute', bottom: 22, width: 30, height: 30, borderRadius: '50%', border: '2px solid var(--bg)' }
