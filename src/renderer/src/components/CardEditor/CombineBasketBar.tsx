import { useState } from 'react'
import { useUiStore } from '../../state/uiStore'
import { useCardsStore } from '../../state/cardsStore'

export function CombineBasketBar(): JSX.Element {
  const basket = useUiStore((s) => s.combineBasket)
  const removeFromBasket = useUiStore((s) => s.removeFromBasket)
  const clearBasket = useUiStore((s) => s.clearBasket)
  const createFromSources = useCardsStore((s) => s.createFromSources)

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(): Promise<void> {
    setError(null)
    setCreating(true)
    try {
      const { aiError } = await createFromSources(basket)
      if (aiError) setError(`Card saved, but AI generation failed: ${aiError}`)
      clearBasket()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--modal-bg)',
        color: 'var(--modal-fg)',
        borderTop: '1px solid var(--border)',
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        boxShadow: '0 -4px 20px #00000020',
        zIndex: 40,
        animation: 'slide-up-in 200ms ease'
      }}
    >
      <strong style={{ fontSize: 'var(--font-sm)' }}>Combined card basket ({basket.length})</strong>
      {basket.map((s, i) => (
        <span key={i} style={{ fontSize: 'var(--font-xs)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 8px' }}>
          {s.label}
          <button
            onClick={() => removeFromBasket(i)}
            style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            ✕
          </button>
        </span>
      ))}
      {basket.length === 0 && (
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)' }}>Select elements on any slide and hit "Add to combined card".</span>
      )}
      {error && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--danger)' }}>{error}</span>}
      <div style={{ flex: 1 }} />
      <button disabled={basket.length === 0 || creating} onClick={clearBasket}>
        Clear
      </button>
      <button disabled={basket.length === 0 || creating} onClick={handleCreate}>
        {creating ? 'Generating…' : '✨ Create combined card'}
      </button>
    </div>
  )
}
