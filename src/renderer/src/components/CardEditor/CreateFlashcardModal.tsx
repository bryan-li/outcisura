import { type CSSProperties, type DragEvent } from 'react'
import type { BBox } from '../../../../shared/types'
import { GenerationSettingsPanel } from './GenerationSettingsPanel'
import { OcclusionImage } from '../CardBrowser/OcclusionImage'

export interface StagedImage {
  id: string
  imagePath: string
  /** The captured region's own position on the page — carried through to the eventual card
   *  source's bbox, so "jump to source" still lands in the right spot for each image. */
  bbox: BBox
  face: 'front' | 'back'
}

interface CreateFlashcardModalProps {
  front: string
  onFrontChange: (value: string) => void
  back: string
  onBackChange: (value: string) => void
  hideUntilFlip: boolean
  onHideUntilFlipChange: (value: boolean) => void
  images: StagedImage[]
  onImagesChange: (images: StagedImage[]) => void
  /** Parent hides this modal, enters free-select mode on the page, and reopens once a region's
   *  captured — see DocumentViewer's freeSelectTarget === 'multi' handling. All the form state
   *  above is lifted into the parent specifically so that hide/reopen cycle never loses anything. */
  onRequestScreenshot: () => void
  saving: boolean
  generating: boolean
  error: string | null
  onClose: () => void
  onSave: () => void
  onGenerateWithAi: () => void
}

/** A bigger, standalone card-creation surface — front/back text, the usual AI generation settings,
 *  and (its actual reason for existing) the ability to assemble SEVERAL screenshots onto a card,
 *  each explicitly placed on the front or the back via drag-and-drop, rather than a card only ever
 *  carrying one shared image. Plain HTML5 drag-and-drop (draggable + dataTransfer), not a library —
 *  two drop zones and a handful of thumbnails doesn't need more than the platform already gives. */
export function CreateFlashcardModal({
  front,
  onFrontChange,
  back,
  onBackChange,
  hideUntilFlip,
  onHideUntilFlipChange,
  images,
  onImagesChange,
  onRequestScreenshot,
  saving,
  generating,
  error,
  onClose,
  onSave,
  onGenerateWithAi
}: CreateFlashcardModalProps): JSX.Element {
  const frontImages = images.filter((img) => img.face === 'front')
  const backImages = images.filter((img) => img.face === 'back')
  const busy = saving || generating

  function handleDragStart(e: DragEvent<HTMLDivElement>, id: string): void {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    // Required for onDrop to fire at all — browsers reject drops on a target by default.
    e.preventDefault()
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, face: 'front' | 'back'): void {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    onImagesChange(images.map((img) => (img.id === id ? { ...img, face } : img)))
  }

  function removeImage(id: string): void {
    onImagesChange(images.filter((img) => img.id !== id))
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Create Flashcard</h2>

        <label style={fieldLabelStyle}>
          Front (question)
          <input type="text" value={front} onChange={(e) => onFrontChange(e.target.value)} style={inputStyle} />
        </label>

        <label style={fieldLabelStyle}>
          Back (answer)
          <textarea value={back} onChange={(e) => onBackChange(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <GenerationSettingsPanel />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={hideUntilFlip} onChange={(e) => onHideUntilFlipChange(e.target.checked)} />
            Hide front images until flipped
          </label>
        </div>

        <button onClick={onRequestScreenshot} disabled={busy} style={{ alignSelf: 'flex-start' }}>
          📷 Add screenshot
        </button>

        <div style={dropZoneRowStyle}>
          <DropZone
            label="Front"
            face="front"
            images={frontImages}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'front')}
            onDragStartImage={handleDragStart}
            onRemoveImage={removeImage}
          />
          <DropZone
            label="Back"
            face="back"
            images={backImages}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'back')}
            onDragStartImage={handleDragStart}
            onRemoveImage={removeImage}
          />
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={onGenerateWithAi} disabled={busy}>
            {generating ? 'Generating…' : '✨ Generate with AI'}
          </button>
          <button onClick={onSave} disabled={busy}>
            {saving ? 'Creating…' : 'Create Flashcard'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface DropZoneProps {
  label: string
  face: 'front' | 'back'
  images: StagedImage[]
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onDragStartImage: (e: DragEvent<HTMLDivElement>, id: string) => void
  onRemoveImage: (id: string) => void
}

function DropZone({ label, images, onDragOver, onDrop, onDragStartImage, onRemoveImage }: DropZoneProps): JSX.Element {
  return (
    <div style={dropZoneStyle} onDragOver={onDragOver} onDrop={onDrop}>
      <p style={dropZoneLabelStyle}>{label}</p>
      <div style={dropZoneThumbsStyle}>
        {images.length === 0 && <span style={dropZoneHintStyle}>Drag a screenshot here</span>}
        {images.map((img) => (
          <div
            key={img.id}
            draggable
            onDragStart={(e) => onDragStartImage(e, img.id)}
            style={{ position: 'relative', cursor: 'grab' }}
            title="Drag to the other side, or remove it"
          >
            <OcclusionImage imagePath={img.imagePath} maskBBoxes={[]} revealed maxWidth={80} />
            <button onClick={() => onRemoveImage(img.id)} style={removeButtonStyle} title="Remove this image">
              ✕
            </button>
          </div>
        ))}
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
  width: 560,
  maxWidth: '90vw',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 180ms ease',
  display: 'flex',
  flexDirection: 'column',
  gap: 12
}

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-muted)'
}

const inputStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--fg)',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  fontFamily: 'inherit'
}

const dropZoneRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10
}

const dropZoneStyle: CSSProperties = {
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 8,
  minHeight: 110,
  background: 'var(--bg)'
}

const dropZoneLabelStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.03em'
}

const dropZoneThumbsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6
}

const dropZoneHintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-faint)'
}

const removeButtonStyle: CSSProperties = {
  position: 'absolute',
  top: -6,
  right: -6,
  width: 18,
  height: 18,
  lineHeight: '16px',
  padding: 0,
  fontSize: 11,
  borderRadius: '50%',
  border: '1px solid var(--border)',
  background: 'var(--modal-bg)',
  color: 'var(--fg-muted)',
  cursor: 'pointer'
}
