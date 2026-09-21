import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { PageHeader, pageStyle } from '../dashboardKit'
import { CardGraph } from './CardGraph'

export function GraphPage(): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const documents = useDocumentsStore((s) => s.documents)

  return (
    <div style={{ ...pageStyle, gap: 'var(--space-4)' }}>
      <PageHeader title="Graph" subtitle="How your cards, folders and sources connect — hover to draw nodes in, click to jump." />
      <CardGraph cards={cards} folders={folders} documents={documents} />
    </div>
  )
}
