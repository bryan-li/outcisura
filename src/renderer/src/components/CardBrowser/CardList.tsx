import type { CardRecord } from '../../../../shared/types'
import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { bySortOrder } from '../../utils/cardOrder'
import { CardItem } from './CardItem'
import { MarqueeSelect } from '../Grid/MarqueeSelect'

/** Cards not filed into a folder, grouped by their source document (the default organization). */
export function CardList(): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const documents = useDocumentsStore((s) => s.documents)

  const unfiled = cards.filter((c) => !c.folderId)

  if (unfiled.length === 0) {
    return (
      <p style={{ color: 'var(--fg-muted)' }}>
        {cards.length === 0
          ? 'No flashcards yet — select content in the Library and hit "Create Flashcard".'
          : 'Every card is filed into a folder — check the sidebar.'}
      </p>
    )
  }

  const bySource = new Map<string, CardRecord[]>()
  const noSource: CardRecord[] = []
  for (const card of unfiled) {
    const documentId = card.sources[0]?.documentId
    if (!documentId) {
      noSource.push(card)
      continue
    }
    const list = bySource.get(documentId) ?? []
    list.push(card)
    bySource.set(documentId, list)
  }

  return (
    <MarqueeSelect style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%' }}>
      <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>Cards</h1>
      {[...bySource.entries()].map(([documentId, docCards]) => {
        const sorted = [...docCards].sort(bySortOrder)
        const ids = sorted.map((c) => c.id)
        return (
          <section key={documentId}>
            <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-md)', color: 'var(--fg-muted)', fontWeight: 600 }}>
              {documents.find((d) => d.id === documentId)?.filename ?? 'Unknown document'} ({sorted.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 0' }}>
              {sorted.map((card) => (
                <CardItem key={card.id} card={card} siblingIds={ids} />
              ))}
            </div>
          </section>
        )
      })}
      {noSource.length > 0 &&
        (() => {
          const sorted = [...noSource].sort(bySortOrder)
          const ids = sorted.map((c) => c.id)
          return (
            <section>
              <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-md)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                No source ({sorted.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 0' }}>
                {sorted.map((card) => (
                  <CardItem key={card.id} card={card} siblingIds={ids} />
                ))}
              </div>
            </section>
          )
        })()}
    </MarqueeSelect>
  )
}
