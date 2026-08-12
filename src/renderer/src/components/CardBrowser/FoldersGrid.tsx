import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore } from '../../state/uiStore'
import { getChildren } from '../../utils/folderTree'
import { BentoGrid, BentoTile } from '../Grid/Bento'

export function FoldersGrid(): JSX.Element {
  const folders = useFoldersStore((s) => s.folders)
  const cards = useCardsStore((s) => s.cards)
  const setView = useUiStore((s) => s.setView)

  const unfiledCount = cards.filter((c) => !c.folderId).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0 }}>Folders</h1>
        <p style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>
          {folders.length === 0
            ? 'No folders yet — use ＋ next to Folders in the sidebar.'
            : `${folders.length} folder${folders.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <BentoGrid>
        {folders.map((folder, i) => {
          const ownCards = cards.filter((c) => c.folderId === folder.id)
          const subfolders = getChildren(folders, folder.id)
          const parent = folder.parentId ? folders.find((f) => f.id === folder.parentId) : null
          return (
            <BentoTile
              key={folder.id}
              wide={i === 0 && folders.length > 2}
              onClick={() => setView({ type: 'folder', folderId: folder.id })}
            >
              <div style={{ flexShrink: 0 }}>
                {parent && (
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>in {parent.name}</div>
                )}
                <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.25 }}>
                  📁 {folder.name}
                </div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', marginTop: 2 }}>
                  {ownCards.length} card{ownCards.length === 1 ? '' : 's'}
                  {subfolders.length > 0 && ` · ${subfolders.length} subfolder${subfolders.length === 1 ? '' : 's'}`}
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {ownCards.slice(0, 4).map((card) => (
                  <div
                    key={card.id}
                    style={{
                      fontSize: 'var(--font-xs)',
                      color: 'var(--fg-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    · {card.front.trim() || 'Untitled'}
                  </div>
                ))}
                {ownCards.length > 4 && (
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>+{ownCards.length - 4} more</div>
                )}
              </div>
            </BentoTile>
          )
        })}

        {unfiledCount > 0 && (
          <BentoTile onClick={() => setView({ type: 'cards' })}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600 }}>🗂 Unfiled</div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
              {unfiledCount} card{unfiledCount === 1 ? '' : 's'} grouped by source
            </div>
          </BentoTile>
        )}
      </BentoGrid>
    </div>
  )
}
