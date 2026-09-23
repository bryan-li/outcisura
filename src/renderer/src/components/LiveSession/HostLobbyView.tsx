import { useEffect, useState, type CSSProperties } from 'react'
import { useHostSessionStore } from '../../state/hostSessionStore'
import { useUiStore } from '../../state/uiStore'
import { useSessionChannel } from '../../lib/liveSession/realtime'
import { Eyebrow, TimeLimitPicker, pillPrimaryStyle, sessionCardStyle, stageStyle } from './liveKit'
import { Icon } from '../Icon'

interface HostLobbyViewProps {
  sessionId: string
}

/** Join code + live participant list, shown after createLiveSession but before the host starts the
 *  actual game loop. Participants list refreshes on `participant_joined` broadcasts plus a coarse
 *  fallback poll, since a guest's own INSERT into live_session_participants is the only thing that
 *  actually creates the row this reads. Also where the host sets the answering window before the
 *  first question goes out (it stays adjustable per question once the session is running — see
 *  HostControlView). */
export function HostLobbyView({ sessionId }: HostLobbyViewProps): JSX.Element {
  const joinCode = useHostSessionStore((s) => s.joinCode)
  const folderName = useHostSessionStore((s) => s.folderName)
  const questions = useHostSessionStore((s) => s.questions)
  const participants = useHostSessionStore((s) => s.participants)
  const questionSeconds = useHostSessionStore((s) => s.questionSeconds)
  const setQuestionSeconds = useHostSessionStore((s) => s.setQuestionSeconds)
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
    <div style={stageStyle}>
      <div style={sessionCardStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
          <Eyebrow tinted>
            <Icon name="broadcast" size="1em" />Live session
          </Eyebrow>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: '4px 0 0', textAlign: 'center' }}>
            Hosting <strong style={{ color: 'var(--fg)' }}>{folderName}</strong> · {questions.length} question
            {questions.length === 1 ? '' : 's'}
          </p>
        </div>

        <div style={codeStyle}>{joinCode}</div>
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', margin: '-8px 0 0', textAlign: 'center' }}>
          Players join with this code
        </p>

        <TimeLimitPicker seconds={questionSeconds} onChange={(s) => setQuestionSeconds(s)} hint="Changeable mid-game" />

        <div>
          <Eyebrow>Players ({participants.length})</Eyebrow>
          {participants.length === 0 ? (
            <p style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-sm)', margin: '8px 0 0' }}>Waiting for players to join…</p>
          ) : (
            <ul style={playerListStyle}>
              {participants.map((p) => (
                <li key={p.userId} style={playerChipStyle}>
                  {p.displayName}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

        <button type="button" onClick={() => void handleStart()} style={pillPrimaryStyle}>
          <Icon name="play" size="0.95em" bare />Start session
        </button>
      </div>
    </div>
  )
}

const codeStyle: CSSProperties = {
  fontSize: 44,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textIndent: '0.18em',
  textAlign: 'center',
  padding: 'var(--space-4) var(--space-3)',
  borderRadius: 'var(--radius-panel)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontVariantNumeric: 'tabular-nums'
}

const playerListStyle: CSSProperties = {
  margin: '8px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6
}

/** Each player as a small pill, so a lobby filling up reads as a crowd gathering rather than a list. */
const playerChipStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '5px 12px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid var(--border)',
  background: 'var(--bg-sidebar)',
  animation: 'pop-in 200ms ease'
}
