import { useEffect, useState } from 'react'
import { useExamPapersStore } from '../../state/examPapersStore'
import { useUiStore } from '../../state/uiStore'
import { Icon } from '../Icon'
import { EmptyHint, PageHeader, pageStyle, panelStyle, panelTitleStyle, primaryPillStyle, rowLabelStyle, rowMetaStyle, rowStyle, secondaryPillStyle } from '../dashboardKit'
import { UploadTemplateModal } from './UploadTemplateModal'
import { GeneratePaperModal } from './GeneratePaperModal'
import { TemplateStyleGuideModal } from './TemplateStyleGuideModal'
import type { PaperTemplateRecord } from '../../../../shared/types'

/** Landing page for the exam paper generator: past-paper templates (a structure inferred from
 *  uploaded paper(s) — see UploadTemplateModal) and papers generated from them (fresh questions
 *  grounded in a chosen folder's cards, each backlinked to its source — see GeneratePaperModal and
 *  GeneratedPaperView). Local-only, its own sidebar section, per the design behind it. */
export function ExamPapersView(): JSX.Element {
  const templates = useExamPapersStore((s) => s.templates)
  const papers = useExamPapersStore((s) => s.papers)
  const loaded = useExamPapersStore((s) => s.loaded)
  const load = useExamPapersStore((s) => s.load)
  const deleteTemplate = useExamPapersStore((s) => s.deleteTemplate)
  const deletePaper = useExamPapersStore((s) => s.deletePaper)
  const setView = useUiStore((s) => s.setView)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [generateFor, setGenerateFor] = useState<PaperTemplateRecord | 'pick' | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<PaperTemplateRecord | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div style={pageStyle}>
      <PageHeader
        title="Exam papers"
        subtitle="Upload a past paper to learn its structure, then generate fresh questions from your own cards."
        actions={
          <button onClick={() => setUploadOpen(true)} style={secondaryPillStyle}>
            <Icon name="upload" bare size={14} />Upload past paper
          </button>
        }
      />

      <div className="home-rise" style={{ ...panelStyle, animationDelay: '60ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={panelTitleStyle}>Templates</h2>
          {templates.length > 0 && (
            <button onClick={() => setGenerateFor('pick')} style={primaryPillStyle}>
              <Icon name="sparkles" bare size={14} />Generate a paper
            </button>
          )}
        </div>
        {loaded && templates.length === 0 ? (
          <EmptyHint text="No templates yet — upload a past paper to infer its structure." />
        ) : (
          <div style={listStyleLocal}>
            {templates.map((t) => (
              <div key={t.id} style={rowStyle}>
                <span style={rowLabelStyle}>
                  <Icon name="file-text" size="1em" />
                  {t.name}
                </span>
                <span style={{ ...rowMetaStyle, flexShrink: 0 }}>
                  {t.structure.sections.length} section{t.structure.sections.length === 1 ? '' : 's'} · from {t.sourceFilenames.join(', ')}
                </span>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => setPreviewTemplate(t)} title="Preview style guide" style={iconOnlyButtonStyle}>
                    <Icon name="eye" bare size={14} />
                  </button>
                  <button onClick={() => setGenerateFor(t)} style={secondaryPillStyle}>
                    Generate
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete the template "${t.name}"? Papers already generated from it are unaffected.`)) void deleteTemplate(t.id)
                    }}
                    title="Delete template"
                    style={iconOnlyButtonStyle}
                  >
                    <Icon name="trash" bare size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="home-rise" style={{ ...panelStyle, animationDelay: '120ms' }}>
        <h2 style={panelTitleStyle}>Generated papers</h2>
        {loaded && papers.length === 0 ? (
          <EmptyHint text="Nothing generated yet." />
        ) : (
          <div style={listStyleLocal}>
            {papers.map((p) => (
              <div key={p.id} style={rowStyle}>
                <button onClick={() => setView({ type: 'exam-paper', paperId: p.id })} style={{ ...rowLabelStyle, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, textAlign: 'left' }}>
                  <Icon name="file-text" size="1em" />
                  {p.name}
                </button>
                <span style={{ ...rowMetaStyle, flexShrink: 0 }}>
                  {p.questionCount} question{p.questionCount === 1 ? '' : 's'} · {p.folderNamesSnapshot.join(', ')}
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete the generated paper "${p.name}"?`)) void deletePaper(p.id)
                  }}
                  title="Delete paper"
                  style={iconOnlyButtonStyle}
                >
                  <Icon name="trash" bare size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {uploadOpen && (
        <UploadTemplateModal
          onClose={() => setUploadOpen(false)}
          onCreated={() => {
            setUploadOpen(false)
            void load()
          }}
        />
      )}

      {generateFor !== null && (
        <GeneratePaperModal
          initialTemplate={generateFor === 'pick' ? null : generateFor}
          templates={templates}
          onClose={() => setGenerateFor(null)}
          onCreated={(paperId) => {
            setGenerateFor(null)
            void load()
            setView({ type: 'exam-paper', paperId })
          }}
        />
      )}

      {previewTemplate && (
        <TemplateStyleGuideModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
    </div>
  )
}

const listStyleLocal = { display: 'flex', flexDirection: 'column' as const, gap: 2, margin: '0 -8px' }

const iconOnlyButtonStyle = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-faint)',
  cursor: 'pointer',
  padding: 4,
  display: 'inline-flex'
}
