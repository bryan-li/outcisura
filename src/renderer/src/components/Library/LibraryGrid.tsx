import type { CardRecord, DocumentRecord } from '../../../../shared/types'
import { useDocumentsStore } from '../../state/documentsStore'
import { useCardsStore } from '../../state/cardsStore'
import { useUiStore } from '../../state/uiStore'
import { useDocumentThumbnail } from '../../hooks/useDocumentThumbnail'
import { formatDuration } from '../../utils/formatDuration'
import { BentoGrid, BentoTile } from '../Grid/Bento'
import { DocTypeIcon } from '../Icon'
import { PageHeader, pageStyle } from '../dashboardKit'

export function LibraryGrid(): JSX.Element {
  const documents = useDocumentsStore((s) => s.documents)
  const openDocument = useDocumentsStore((s) => s.openDocument)
  const cards = useCardsStore((s) => s.cards)
  const setView = useUiStore((s) => s.setView)

  async function open(documentId: string): Promise<void> {
    setView({ type: 'library' })
    await openDocument(documentId)
  }

  return (
    <div style={pageStyle}>
      <PageHeader
        title="Library"
        subtitle={
          documents.length === 0
            ? 'Nothing imported yet — use the plus next to Library in the sidebar.'
            : `${documents.length} document${documents.length === 1 ? '' : 's'}`
        }
      />

      {documents.length > 0 && (
        <BentoGrid>
          {documents.map((doc, i) => (
            <DocumentTile
              key={doc.id}
              document={doc}
              cards={cards}
              wide={i === 0}
              tall={i === 0}
              onClick={() => open(doc.id)}
            />
          ))}
        </BentoGrid>
      )}
    </div>
  )
}

interface DocumentTileProps {
  document: DocumentRecord
  cards: CardRecord[]
  wide?: boolean
  tall?: boolean
  onClick: () => void
}

function DocumentTile({ document, cards, wide, tall, onClick }: DocumentTileProps): JSX.Element {
  const thumbnail = useDocumentThumbnail(document.id)
  const cardCount = cards.filter((c) => c.sources.some((s) => s.documentId === document.id)).length

  return (
    <BentoTile onClick={onClick} wide={wide} tall={tall}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: thumbnail ? '#fff' : 'var(--bg-sidebar)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        ) : (
          <span style={{ opacity: 0.35, display: 'inline-flex' }}>
            <DocTypeIcon type={document.type} bare size={32} />
          </span>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--font-md)', fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.25 }}>
          {document.filename}
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', marginTop: 2 }}>
          {document.type.toUpperCase()} ·{' '}
          {document.type === 'video'
            ? document.durationSeconds !== null
              ? formatDuration(document.durationSeconds)
              : '—'
            : `${document.pageCount} slides`}{' '}
          · {cardCount} card{cardCount === 1 ? '' : 's'}
        </div>
      </div>
    </BentoTile>
  )
}
