import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { DocumentRecord, OrphanedSourceRecord } from '../../../../shared/types'
import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useUiStore } from '../../state/uiStore'
import { useConnectivityStore } from '../../state/connectivityStore'
import { triggerSync } from '../../lib/syncEngine'
import { resolveOrphanAgainstPages } from '../../lib/resolveOrphanSource'
import { parsePdf } from '../../parsers/pdfParser'
import { parsePptx } from '../../parsers/pptxParser'

/** Sources a cross-device pull couldn't resolve locally (see repository.ts's applyRemoteCardUpsert/
 *  replaceOrphanedSource/recaptureOrphanedSource/dismissOrphanedSource). Three ways to resolve one:
 *  recapture a region from a local document (best fidelity — real document/page backlink, not just
 *  a raw image), upload a replacement image directly (quicker, no matching document needed), or
 *  just dismiss it — accept the card as-is on this device with one fewer source, for when the
 *  source genuinely doesn't matter here. Recapture and upload only fix the card on THIS device —
 *  the replacement image is itself a local file that never syncs, so another device that later
 *  pulls this same card will independently see its own orphan for it. That's an accepted
 *  characteristic of images staying local-only, not a bug here. */
export function MissingSourcesView(): JSX.Element {
  const setView = useUiStore((s) => s.setView)
  const startRecapture = useUiStore((s) => s.startRecapture)
  const cards = useCardsStore((s) => s.cards)
  const setCards = useCardsStore((s) => s.setCards)
  const documents = useDocumentsStore((s) => s.documents)
  const loadDocuments = useDocumentsStore((s) => s.loadDocuments)
  const openDocument = useDocumentsStore((s) => s.openDocument)

  const [orphans, setOrphans] = useState<OrphanedSourceRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Which orphan's manual picker is open — only ever set as a fallback, when autonomous matching
  // below couldn't resolve anything on its own. Controlled here (not local to OrphanRow) so the
  // auto-match attempt can open it on failure.
  const [menuOrphanId, setMenuOrphanId] = useState<string | null>(null)
  const lastSyncedAt = useConnectivityStore((s) => s.lastSyncedAt)

  useEffect(() => {
    window.api.cards.getOrphanedSources().then(setOrphans)
  }, [])

  // A sync cycle can auto-resolve an orphan in the background (see syncEngine.ts's
  // autoResolveOrphans, for an unambiguous local filename match) or pull in a fresh one — re-fetch
  // whenever a cycle completes so this list doesn't go stale while the user's looking at it.
  useEffect(() => {
    if (!lastSyncedAt) return
    window.api.cards.getOrphanedSources().then(setOrphans)
  }, [lastSyncedAt])

  function goBack(): void {
    setView({ type: 'home' })
  }

  async function handleUpload(orphan: OrphanedSourceRecord, file: File): Promise<void> {
    setBusyId(orphan.id)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      const imagePath = await window.api.documents.saveImage(dataUrl)
      const updatedCard = await window.api.cards.replaceOrphanedSource(orphan.id, { imagePath })
      setCards(useCardsStore.getState().cards.map((c) => (c.id === updatedCard.id ? updatedCard : c)))
      setOrphans((prev) => (prev ? prev.filter((o) => o.id !== orphan.id) : prev))
      triggerSync()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replace source')
    } finally {
      setBusyId(null)
    }
  }

  /** The actual crop-and-attach step, shared by every recapture path below. Applies the orphan's
   *  already-synced bbox/sourcePageIndex snapshot against a document that's already imported and
   *  open locally — no manual page-hunting or re-drawing a selection, since that data already
   *  exists (page ordering is fully deterministic for a given file: parsePdf/parsePptx always
   *  assign pageIndex in file order, on any device). Returns false (no side effects beyond opening
   *  the document) rather than throwing when the expected page just isn't there, so callers can
   *  keep trying other candidate documents before giving up. */
  async function tryResolveAgainstDocument(orphan: OrphanedSourceRecord, documentId: string, documentLabel: string): Promise<boolean> {
    await openDocument(documentId)
    const pages = useDocumentsStore.getState().pagesByDocument[documentId] ?? []
    const updatedCard = await resolveOrphanAgainstPages(orphan, documentId, documentLabel, pages)
    if (!updatedCard) return false
    setCards(useCardsStore.getState().cards.map((c) => (c.id === updatedCard.id ? updatedCard : c)))
    setOrphans((prev) => (prev ? prev.filter((o) => o.id !== orphan.id) : prev))
    triggerSync()
    return true
  }

  /** Primary entry point: tries every already-imported Library document whose filename matches
   *  the orphan's own snapshot, entirely on its own — no menu, no click beyond this one. Only
   *  falls back to asking the user (the manual picker: pick a different existing document, or
   *  import a fresh one) when nothing local resolves it automatically. */
  async function handleAutoRecapture(orphan: OrphanedSourceRecord): Promise<void> {
    setBusyId(orphan.id)
    setError(null)
    setMenuOrphanId(null)
    try {
      const candidates = orphan.sourceDocumentFilename ? documents.filter((d) => d.filename === orphan.sourceDocumentFilename) : []
      for (const doc of candidates) {
        if (await tryResolveAgainstDocument(orphan, doc.id, doc.filename)) return
      }
      setError(
        candidates.length > 0
          ? `Found "${orphan.sourceDocumentFilename}" in your library, but couldn't locate the right page automatically — pick manually below.`
          : orphan.sourceDocumentFilename
            ? `No local document matches "${orphan.sourceDocumentFilename}" yet — pick one below or import it.`
            : `No source document info available for this card — pick a document below or import it.`
      )
      setMenuOrphanId(orphan.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recapture source')
    } finally {
      setBusyId(null)
    }
  }

  /** Manual fallback: the user picked a specific existing Library document themselves (the
   *  automatic filename match above either found nothing or picked the wrong copy). */
  async function handleRecaptureExisting(orphan: OrphanedSourceRecord, documentId: string, filename: string): Promise<void> {
    setBusyId(orphan.id)
    setError(null)
    try {
      const resolved = await tryResolveAgainstDocument(orphan, documentId, filename)
      if (!resolved) {
        setError(`Couldn't find page ${(orphan.sourcePageIndex ?? 0) + 1} in "${filename}" — opening it so you can select the region manually.`)
        startRecapture({ orphanId: orphan.id, cardId: orphan.cardId, label: orphan.label })
        setView({ type: 'library' })
      } else {
        setMenuOrphanId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recapture source')
    } finally {
      setBusyId(null)
    }
  }

  /** Manual fallback: the user imports a fresh file (the source document isn't in the Library at all). */
  async function handleRecaptureFile(orphan: OrphanedSourceRecord, file: File): Promise<void> {
    setBusyId(orphan.id)
    setError(null)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      const parsed = ext === 'pdf' ? await parsePdf(file) : ext === 'pptx' ? await parsePptx(file) : null
      if (!parsed) throw new Error('Choose a .pdf or .pptx file')

      const record = await window.api.documents.import(parsed)
      await loadDocuments()
      const resolved = await tryResolveAgainstDocument(orphan, record.id, record.filename)
      if (!resolved) {
        setError(
          `Couldn't automatically find page ${(orphan.sourcePageIndex ?? 0) + 1} of "${file.name}" — opening it so you can select the region manually.`
        )
        startRecapture({ orphanId: orphan.id, cardId: orphan.cardId, label: orphan.label })
        setView({ type: 'library' })
      } else {
        setMenuOrphanId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recapture source')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDismiss(orphan: OrphanedSourceRecord): Promise<void> {
    setBusyId(orphan.id)
    setError(null)
    try {
      const updatedCard = await window.api.cards.dismissOrphanedSource(orphan.id)
      setCards(useCardsStore.getState().cards.map((c) => (c.id === updatedCard.id ? updatedCard : c)))
      setOrphans((prev) => (prev ? prev.filter((o) => o.id !== orphan.id) : prev))
      // Not synced — dismissing is a purely local "don't need this here" choice, see
      // dismissOrphanedSource's own doc comment. No triggerSync() call needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss source')
    } finally {
      setBusyId(null)
    }
  }

  const byCard = new Map<string, OrphanedSourceRecord[]>()
  for (const o of orphans ?? []) {
    const list = byCard.get(o.cardId) ?? []
    list.push(o)
    byCard.set(o.cardId, list)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 640 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button onClick={goBack} style={backButtonStyle} title="Back">
          ← Back
        </button>
      </header>

      <div>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0 }}>Missing sources</h1>
        <p style={hintStyle}>
          Cards pulled from another device can reference a document, page, or image that only exists
          there — documents and images stay local to each device, only card content syncs. Recapture
          the region from a local copy of the source document, upload a replacement image, or dismiss
          it if the card doesn't need a source on this device.
        </p>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

      {orphans === null && <p style={hintStyle}>Loading…</p>}
      {orphans !== null && orphans.length === 0 && <p style={hintStyle}>Nothing missing right now.</p>}

      {[...byCard.entries()].map(([cardId, cardOrphans]) => {
        const card = cards.find((c) => c.id === cardId)
        return (
          <section key={cardId} style={sectionStyle}>
            <p style={{ fontSize: 'var(--font-md)', fontWeight: 600, margin: 0 }}>{card?.front.trim() || 'Untitled card'}</p>
            {card?.back && <p style={hintStyle}>{card.back}</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {cardOrphans.map((orphan) => (
                <OrphanRow
                  key={orphan.id}
                  orphan={orphan}
                  documents={documents}
                  busy={busyId === orphan.id}
                  menuOpen={menuOrphanId === orphan.id}
                  onCloseMenu={() => setMenuOrphanId(null)}
                  onUpload={(file) => handleUpload(orphan, file)}
                  onAutoRecapture={() => handleAutoRecapture(orphan)}
                  onRecaptureExisting={(documentId, filename) => handleRecaptureExisting(orphan, documentId, filename)}
                  onRecaptureFile={(file) => handleRecaptureFile(orphan, file)}
                  onDismiss={() => handleDismiss(orphan)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function OrphanRow({
  orphan,
  documents,
  busy,
  menuOpen,
  onCloseMenu,
  onUpload,
  onAutoRecapture,
  onRecaptureExisting,
  onRecaptureFile,
  onDismiss
}: {
  orphan: OrphanedSourceRecord
  documents: DocumentRecord[]
  busy: boolean
  menuOpen: boolean
  onCloseMenu: () => void
  onUpload: (file: File) => void
  onAutoRecapture: () => void
  onRecaptureExisting: (documentId: string, filename: string) => void
  onRecaptureFile: (file: File) => void
  onDismiss: () => void
}): JSX.Element {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const recaptureInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onCloseMenu()
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [menuOpen, onCloseMenu])

  const hint =
    orphan.reason === 'missing_file'
      ? 'Image file missing on this device'
      : orphan.sourceDocumentFilename
        ? `From page ${(orphan.sourcePageIndex ?? 0) + 1} of "${orphan.sourceDocumentFilename}"`
        : 'Source document not found on this device'

  // Documents likely to actually contain this page — same filename first, everything else after,
  // so a shared-source deck the user already imported for a different card shows up front.
  const candidates = [...documents].sort((a, b) => {
    const aMatch = a.filename === orphan.sourceDocumentFilename ? 0 : 1
    const bMatch = b.filename === orphan.sourceDocumentFilename ? 0 : 1
    return aMatch - bMatch
  })

  return (
    <div style={rowStyle}>
      <div>
        <p style={{ margin: 0, fontSize: 'var(--font-sm)' }}>{orphan.label}</p>
        <p style={{ ...hintStyle, margin: 0 }}>{hint}</p>
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          e.target.value = ''
        }}
      />
      <input
        ref={recaptureInputRef}
        type="file"
        accept=".pdf,.pptx"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onRecaptureFile(file)
          e.target.value = ''
        }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0, position: 'relative' }} ref={menuRef}>
        <button disabled={busy} onClick={onDismiss} style={quietTextButtonStyle}>
          {busy ? '…' : 'Continue without source'}
        </button>
        <button disabled={busy} onClick={() => uploadInputRef.current?.click()} style={quietTextButtonStyle}>
          {busy ? 'Uploading…' : 'Upload replacement'}
        </button>
        <button disabled={busy} onClick={onAutoRecapture} style={primaryButtonStyle}>
          {busy ? 'Working…' : 'Recapture from document'}
        </button>
        {menuOpen && (
          <div style={recaptureMenuStyle}>
            {candidates.length > 0 && (
              <>
                {candidates.map((doc) => (
                  <button
                    key={doc.id}
                    style={recaptureMenuItemStyle}
                    onClick={() => {
                      onCloseMenu()
                      onRecaptureExisting(doc.id, doc.filename)
                    }}
                  >
                    📄 {doc.filename}
                  </button>
                ))}
                <div style={recaptureMenuDividerStyle} />
              </>
            )}
            <button
              style={recaptureMenuItemStyle}
              onClick={() => {
                onCloseMenu()
                recaptureInputRef.current?.click()
              }}
            >
              📁 Import new file…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const backButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  padding: '4px 6px'
}

const hintStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  color: 'var(--fg-muted)',
  margin: 0
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  paddingBottom: 'var(--space-4)',
  borderBottom: '1px solid var(--border)'
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '6px 14px',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const quietTextButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  whiteSpace: 'nowrap'
}

const recaptureMenuStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 4,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 220,
  maxWidth: 320,
  maxHeight: 260,
  overflowY: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  zIndex: 10,
  padding: 4
}

const recaptureMenuItemStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'inherit',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const recaptureMenuDividerStyle: CSSProperties = {
  height: 1,
  background: 'var(--border)',
  margin: '4px 0'
}
