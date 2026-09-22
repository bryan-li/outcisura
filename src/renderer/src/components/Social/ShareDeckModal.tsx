import { useEffect, useState, type CSSProperties } from 'react'
import { useAuthStore } from '../../state/authStore'
import { useSocialStore } from '../../state/socialStore'
import { listMySharesFor, shareFolderWithFriend, socialErrorMessage, unshareDeckForFriend } from '../../lib/social'
import { Icon } from '../Icon'
import { EmptyHint, listStyle, primaryPillStyle, rowLabelStyle, rowStyle, secondaryPillStyle } from '../dashboardKit'

interface ShareDeckModalProps {
  folderId: string
  folderName: string
  onClose: () => void
}

/** Opened from a folder's ⋯ menu (see Sidebar.tsx) — a plain list of your friends, each with a
 *  toggle for whether this specific folder is currently shared with them. No separate "existing
 *  shares" view; sharing/unsharing is symmetric and this is the one place either happens. */
export function ShareDeckModal({ folderId, folderName, onClose }: ShareDeckModalProps): JSX.Element {
  const userId = useAuthStore((s) => s.session?.user.id)
  const friends = useSocialStore((s) => s.friends)
  const loadFriends = useSocialStore((s) => s.load)
  const [sharedWith, setSharedWith] = useState<Set<string> | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (userId) void loadFriends(userId)
    listMySharesFor(folderId)
      .then(setSharedWith)
      .catch((err) => setError(socialErrorMessage(err, 'Failed to load')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId])

  async function toggle(friendUserId: string, currentlyShared: boolean): Promise<void> {
    setBusyId(friendUserId)
    setError(null)
    try {
      if (currentlyShared) {
        await unshareDeckForFriend(folderId, friendUserId)
      } else {
        await shareFolderWithFriend(folderId, folderName, friendUserId)
      }
      setSharedWith((prev) => {
        const next = new Set(prev)
        if (currentlyShared) next.delete(friendUserId)
        else next.add(friendUserId)
        return next
      })
    } catch (err) {
      setError(socialErrorMessage(err, 'Failed to update sharing'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>
            <Icon name="send" />Share "{folderName}"
          </h2>
          <button onClick={onClose} style={closeButtonStyle} title="Close">
            <Icon name="x" bare />
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
        {friends.length === 0 ? (
          <EmptyHint text="You don't have any friends yet — add one from the Social tab first." />
        ) : sharedWith === null ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)', margin: 0 }}>Loading…</p>
        ) : (
          <div style={listStyle}>
            {friends.map((f) => {
              const shared = sharedWith.has(f.userId)
              return (
                <div key={f.userId} style={rowStyle}>
                  <span style={rowLabelStyle}>{f.username}</span>
                  <button disabled={busyId === f.userId} onClick={() => void toggle(f.userId, shared)} style={shared ? secondaryPillStyle : primaryPillStyle}>
                    {busyId === f.userId ? '…' : shared ? 'Shared — remove' : 'Share'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#00000066',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
  animation: 'fade-in 150ms ease'
}

const modalStyle: CSSProperties = {
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-5)',
  width: 420,
  maxWidth: '90vw',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 180ms ease',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)'
}

const closeButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  display: 'inline-flex'
}
