import { useEffect, useState, type CSSProperties } from 'react'
import { useHostSessionStore } from '../../state/hostSessionStore'
import { useUiStore } from '../../state/uiStore'
import { useSessionChannel } from '../../lib/liveSession/realtime'

interface HostLobbyViewProps {
  sessionId: string
}

/** Join code + live participant list, shown after createLiveSession but before the host starts the
 *  actual game loop. Participants list refreshes on `participant_joined` broadcasts plus a coarse
 *  fallback poll, since a guest's own INSERT into live_session_participants is the only thing that
 *  actually creates the row this reads. */
export function HostLobbyView({ sessionId }: HostLobbyViewProps): JSX.Element {
  const joinCode = useHostSessionStore((s) => s.joinCode)
  const folderName = useHostSessionStore((s) => s.folderName)
  const questions = useHostSessionStore((s) => s.questions)
  const participants = useHostSessionStore((s) => s.participants)
  const refreshParticipants = useHostSessionStore((s) => s.refreshParticipants)
  const startSession = useHostSessionStore((s) => s.startSession)
  const setView = useUiStore((s) => s.setView)
  const [error, setError] = useState<string | null>(null)

  const send = useSessionChannel(sessionId, (event) => {
    if (event.type === 'participant_joined') void refreshParticipants()
  })

  useEffect(() => {
    void refreshParticipants()
    const timer = setInterval(() => void refreshParticipants(), 3000)
    return () => clearInterval(timer)
  }, [refreshParticipants])

  async function handleStart(): Promise<void> {
    try {
      await startSession()
      const { deadline } = useHostSessionStore.getState()
      if (!deadline) return
      send({ type: 'question_advanced', questionIndex: 0, deadline })
      setView({ type: 'host-control', sessionId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the session')
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>
          Hosting <strong>{folderName}</strong> · {questions.length} question{questions.length === 1 ? '' : 's'}
        </p>
        <div style={codeStyle}>{joinCode}</div>
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', margin: 0, textAlign: 'center' }}>
          Players join at the guest screen with this code
        </p>

        <div>
          <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--fg-faint)', textTransform: 'uppercase', margin: '0 0 6px' }}>
            Players ({participants.length})
          </p>
          {participants.length === 0 ? (
            <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)', margin: 0 }}>Waiting for players to join…</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {participants.map((p) => (
                <li key={p.userId} style={{ fontSize: 'var(--font-sm)' }}>
                  {p.displayName}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

        <button type="button" onClick={() => void handleStart()} style={primaryButtonStyle}>
          ▶ Start Session
        </button>
      </div>
    </div>
  )
}

const pageStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%'
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  width: 380,
  padding: 'var(--space-6)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)'
}

const codeStyle: CSSProperties = {
  fontSize: 40,
  fontWeight: 700,
  letterSpacing: '0.15em',
  textAlign: 'center',
  padding: 'var(--space-3)',
  border: '1px dashed var(--accent)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--accent)'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 'var(--font-md)'
}
