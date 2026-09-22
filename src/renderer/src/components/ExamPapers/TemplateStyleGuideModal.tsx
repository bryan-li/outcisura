import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { secondaryPillStyle } from '../dashboardKit'
import { SectionStyleList } from './SectionStyleList'
import type { PaperTemplateRecord } from '../../../../shared/types'

interface TemplateStyleGuideModalProps {
  template: PaperTemplateRecord
  onClose: () => void
}

/** Read-only preview of an already-saved template's inferred structure and style guide — how each
 *  section's questions are phrased, not just their shape. Opened from a template row in
 *  ExamPapersView so you can check a template's style before generating from it, without
 *  re-uploading. Shares its section rendering with UploadTemplateModal's post-analysis preview via
 *  SectionStyleList so both read identically. */
export function TemplateStyleGuideModal({ template, onClose }: TemplateStyleGuideModalProps): JSX.Element {
  const { structure } = template

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>
            <Icon name="eye" />
            {template.name}
          </h2>
          <button onClick={onClose} style={closeButtonStyle} title="Close">
            <Icon name="x" bare />
          </button>
        </div>

        <p style={hintStyle}>
          {structure.totalMarks !== null ? `${structure.totalMarks} marks total. ` : ''}
          From {template.sourceFilenames.join(', ')}.
        </p>

        <SectionStyleList sections={structure.sections} />

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={secondaryPillStyle}>
            Close
          </button>
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
