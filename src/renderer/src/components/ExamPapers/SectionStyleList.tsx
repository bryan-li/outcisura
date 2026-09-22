import type { CSSProperties } from 'react'
import type { PaperSection } from '../../../../shared/types'

/** Shared section-by-section rendering of a template's structure + style guide — how many
 *  questions, what format/marks, and (the actually useful bit for judging a template before you
 *  commit to it) how its questions are phrased. Used by both UploadTemplateModal's post-analysis
 *  preview and TemplateStyleGuideModal's read-only view of an already-saved template, so the two
 *  always read identically. */
export function SectionStyleList({ sections }: { sections: PaperSection[] }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {sections.map((s, i) => (
        <div key={i} style={sectionStyle}>
          <strong style={{ fontSize: 'var(--font-sm)' }}>{s.name}</strong>
          <span style={hintStyle}>
            {s.questionCount} × {s.format.replace('_', ' ')}
            {s.marksPerQuestion !== null ? ` · ${s.marksPerQuestion} mark(s) each` : ''}
          </span>
          {s.instructions && <span style={hintStyle}>{s.instructions}</span>}
          <span style={{ ...hintStyle, fontStyle: 'italic' }}>{s.questionStyle}</span>
        </div>
      ))}
    </div>
  )
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 'var(--space-2) var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-row)'
}

const hintStyle: CSSProperties = { fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }
