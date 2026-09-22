import { useState, type CSSProperties } from 'react'
import { extractPdfText } from '../../parsers/pdfText'
import { supabaseErrorMessage } from '../../lib/supabaseError'
import { Icon } from '../Icon'
import { primaryPillStyle, secondaryPillStyle } from '../dashboardKit'
import type { PaperTemplateStructure } from '../../../../shared/types'

interface UploadTemplateModalProps {
  onClose: () => void
  onCreated: () => void
}

const MAX_FILES = 5

/** Upload one or more past papers (PDF) → extract their text client-side → one AI call infers the
 *  STRUCTURE (sections/formats/counts/marks — never the actual question content, which is never
 *  persisted anywhere past this call) → save as a named template. See aiService.ts's
 *  extractPaperTemplate for the prompt and shared/types.ts's PaperTemplateStructure for the shape. */
export function UploadTemplateModal({ onClose, onCreated }: UploadTemplateModalProps): JSX.Element {
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<'idle' | 'reading' | 'thinking' | 'saving'>('idle')
  const [preview, setPreview] = useState<PaperTemplateStructure | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = phase !== 'idle'

  function handleFiles(list: FileList | null): void {
    if (!list) return
    const pdfs = [...list].filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length === 0) {
      setError('Choose one or more .pdf files.')
      return
    }
    setError(null)
    setFiles(pdfs.slice(0, MAX_FILES))
    if (!name.trim()) setName(pdfs[0].name.replace(/\.pdf$/i, ''))
  }

  async function handleExtract(): Promise<void> {
    setError(null)
    setPreview(null)
    setPhase('reading')
    try {
      const papers = await Promise.all(
        files.map(async (f) => ({ filename: f.name, text: await extractPdfText(f) }))
      )
      const empty = papers.filter((p) => !p.text.trim())
      if (empty.length === papers.length) {
        throw new Error('No text could be extracted — this may be a scanned/image-only PDF.')
      }
      setPhase('thinking')
      const result = await window.api.ai.extractPaperTemplate({ papers: papers.filter((p) => p.text.trim()) })
      setPreview(result.structure)
    } catch (err) {
      setError(supabaseErrorMessage(err, 'Failed to analyze the paper'))
    } finally {
      setPhase('idle')
    }
  }

  async function handleSave(): Promise<void> {
    if (!preview) return
    setError(null)
    setPhase('saving')
    try {
      await window.api.paperTemplates.create({
        name: name.trim() || preview.paperTitle,
        sourceFilenames: files.map((f) => f.name),
        structure: preview
      })
      onCreated()
    } catch (err) {
      setError(supabaseErrorMessage(err, 'Failed to save the template'))
      setPhase('idle')
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>
            <Icon name="upload" />Upload a past paper
          </h2>
          <button onClick={onClose} style={closeButtonStyle} title="Close">
            <Icon name="x" bare />
          </button>
        </div>

        {!preview && (
          <>
            <p style={hintStyle}>
              Up to {MAX_FILES} PDFs of the same paper series. Only the STRUCTURE is used — section names, formats,
              question counts and marks — never any actual question text, which is discarded once this finishes.
            </p>
            <input type="file" accept=".pdf" multiple onChange={(e) => handleFiles(e.target.files)} disabled={busy} />
            {files.length > 0 && (
              <p style={hintStyle}>{files.map((f) => f.name).join(', ')}</p>
            )}
            <label style={fieldLabelStyle}>
              Template name
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} style={inputStyle} placeholder="e.g. AP Biology final" />
            </label>
          </>
        )}

        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <p style={hintStyle}>
              Inferred structure — {preview.totalMarks !== null ? `${preview.totalMarks} marks total. ` : ''}Edit the name above if you like, then save.
            </p>
            {preview.sections.map((s, i) => (
              <div key={i} style={sectionPreviewStyle}>
                <strong style={{ fontSize: 'var(--font-sm)' }}>{s.name}</strong>
                <span style={hintStyle}>
                  {s.questionCount} × {s.format.replace('_', ' ')}
                  {s.marksPerQuestion !== null ? ` · ${s.marksPerQuestion} mark(s) each` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={secondaryPillStyle} disabled={busy}>
            Cancel
          </button>
          {!preview ? (
            <button onClick={() => void handleExtract()} disabled={files.length === 0 || busy} style={primaryPillStyle}>
              {phase === 'reading' ? 'Reading…' : phase === 'thinking' ? 'Analyzing…' : 'Analyze structure'}
            </button>
          ) : (
            <button onClick={() => void handleSave()} disabled={busy} style={primaryPillStyle}>
              {phase === 'saving' ? 'Saving…' : 'Save template'}
            </button>
          )}
        </div>
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
  width: 520,
  maxWidth: '90vw',
  maxHeight: '85vh',
  overflow: 'auto',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 180ms ease',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)'
}

const closeButtonStyle: CSSProperties = { border: 'none', background: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 16, padding: 4 }

const hintStyle: CSSProperties = { fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }

const fieldLabelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-sm)', fontWeight: 600 }

const inputStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontWeight: 400,
  fontSize: 'var(--font-sm)',
  padding: '6px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit'
}

const sectionPreviewStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 'var(--space-2) var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-row)'
}
