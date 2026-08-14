import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { CardGraph } from './CardGraph'

export function GraphPage(): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const documents = useDocumentsStore((s) => s.documents)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 960 }}>
      <div>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0 }}>Graph</h1>
        <p style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>
          How your cards, folders, and source documents connect.
        </p>
      </div>
      <CardGraph cards={cards} folders={folders} documents={documents} />
    </div>
  )
}
