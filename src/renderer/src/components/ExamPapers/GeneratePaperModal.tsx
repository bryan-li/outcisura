import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useExamPapersStore } from '../../state/examPapersStore'
import { supabaseErrorMessage } from '../../lib/supabaseError'
import { Icon } from '../Icon'
import { primaryPillStyle, secondaryPillStyle } from '../dashboardKit'
import { GenerationProgressBar } from './GenerationProgressBar'
import type { PaperTemplateRecord } from '../../../../shared/types'

interface GeneratePaperModalProps {
  initialTemplate: PaperTemplateRecord | null
  templates: PaperTemplateRecord[]
  onClose: () => void
  onCreated: (paperId: string) => void
}

/** Pick a template + one or more folders, then one AI call writes fresh questions grounded in
 *  those folders' cards, each backlinked to the card(s) it actually drew from. Cards are handed to
 *  the AI as small `ref` integers (not their real ids) so it never has to reproduce a UUID
 *  accurately — see shared/types.ts's AiGeneratePaperQuestionsRequest and aiService.ts's
 *  generatePaperQuestions for why, and repository.ts's createGeneratedPaper for how the refs get
 *  mapped back and any stale/hallucinated ones are dropped rather than failing the save.
 *
 *  Generation is a single (sometimes slow) AI call, so this modal stays dismissible the whole time
 *  — closing it (backdrop click, the × button, or "Close") doesn't cancel the in-flight request,
 *  it just stops watching for the result. If the modal was dismissed before the call finishes, the
 *  finished paper is still saved and the list is quietly refreshed via examPapersStore, but we
 *  don't yank the view over to it — only a still-open modal does that (via onCreated). */
export function GeneratePaperModal({ initialTemplate, templates, onClose, onCreated }: GeneratePaperModalProps): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const loadExamPapers = useExamPapersStore((s) => s.load)

  const [templateId, setTemplateId] = useState<string | null>(initialTemplate?.id ?? templates[0]?.id ?? null)
  const [folderIds, setFolderIds] = useState<string[]>([])
  const [paperName, setPaperName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dismissedRef = useRef(false)

  const template = templates.find((t) => t.id === templateId) ?? null
  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.name.localeCompare(b.name)), [folders])

  const eligibleCards = useMemo(
    () => (folderIds.length === 0 ? [] : cards.filter((c) => c.folderId && folderIds.includes(c.folderId))),
    [cards, folderIds]
  )

  function toggleFolder(id: string): void {
    setFolderIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))
  }

  function handleDismiss(): void {
    dismissedRef.current = true
    onClose()
  }

  async function handleGenerate(): Promise<void> {
    if (!template || eligibleCards.length === 0) return
    setError(null)
    setBusy(true)
    try {
      const refMap = new Map<number, string>()
      const aiCards = eligibleCards.map((c, i) => {
        const ref = i + 1
        refMap.set(ref, c.id)
        return { ref, front: c.front, back: c.back }
      })

      const result = await window.api.ai.generatePaperQuestions({ structure: template.structure, cards: aiCards })

      const questions = result.questions.map((q) => ({
        sectionIndex: q.sectionIndex,
        sectionName: template.structure.sections[q.sectionIndex]?.name ?? `Section ${q.sectionIndex + 1}`,
        questionIndex: 0,
        format: q.format,
        prompt: q.prompt,
        marks: q.marks,
        mcqOptions: q.mcqOptions,
        mcqCorrectIndex: q.mcqCorrectIndex,
        modelAnswer: q.modelAnswer,
        cardIds: q.cardRefs.map((ref) => refMap.get(ref)).filter((id): id is string => Boolean(id))
      }))

      // Number questions within each section in the order they came back, since the AI only
      // reports which section a question belongs to, not its position within it.
      const perSectionCounter = new Map<number, number>()
      for (const q of questions) {
        const next = (perSectionCounter.get(q.sectionIndex) ?? 0) + 1
        perSectionCounter.set(q.sectionIndex, next)
        q.questionIndex = next - 1
      }

      const folderNamesSnapshot = folderIds.map((id) => folders.find((f) => f.id === id)?.name ?? 'Unknown folder')

      const paper = await window.api.generatedPapers.create({
        templateId: template.id,
        templateNameSnapshot: template.name,
        name: paperName.trim() || `${template.name} — ${new Date().toLocaleDateString()}`,
        folderNamesSnapshot,
        questions
      })

      if (dismissedRef.current) {
        // The modal is already gone — don't yank the view to the new paper, just make sure it
        // shows up in the list next time the user looks.
        void loadExamPapers()
      } else {
        onCreated(paper.id)
      }
    } catch (err) {
      if (!dismissedRef.current) setError(supabaseErrorMessage(err, 'Failed to generate the paper'))
      setBusy(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={handleDismiss}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>
            <Icon name="sparkles" />Generate a paper
          </h2>
          <button onClick={handleDismiss} style={closeButtonStyle} title="Close">
            <Icon name="x" bare />
          </button>
        </div>

        <label style={fieldLabelStyle}>
          Template
          <select value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value)} disabled={busy} style={inputStyle}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldLabelStyle}>
          Paper name
          <input
            value={paperName}
            onChange={(e) => setPaperName(e.target.value)}
            disabled={busy}
            style={inputStyle}
            placeholder={template ? `${template.name} — ${new Date().toLocaleDateString()}` : ''}
          />
        </label>

        <div style={fieldLabelStyle}>
          Folders to draw questions from
          <div style={folderListStyle}>
            {sortedFolders.length === 0 && <p style={hintStyle}>No folders yet.</p>}
            {sortedFolders.map((f) => (
              <label key={f.id} style={folderRowStyle}>
                <input type="checkbox" checked={folderIds.includes(f.id)} onChange={() => toggleFolder(f.id)} disabled={busy} />
                {f.name}
                <span style={{ ...hintStyle, marginLeft: 'auto' }}>{cards.filter((c) => c.folderId === f.id).length} cards</span>
              </label>
            ))}
          </div>
        </div>

        <p style={hintStyle}>
          {eligibleCards.length} card{eligibleCards.length === 1 ? '' : 's'} available from the selected folder
          {folderIds.length === 1 ? '' : 's'}.
        </p>

        {busy && (
          <div>
            <GenerationProgressBar label="Writing questions from your cards…" />
            <p style={{ ...hintStyle, marginTop: 6 }}>
              This can take a moment — feel free to close this and keep working, the paper will be ready when it's done.
            </p>
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button onClick={handleDismiss} style={secondaryPillStyle}>
            {busy ? 'Close' : 'Cancel'}
          </button>
          <button onClick={() => void handleGenerate()} disabled={busy || !template || eligibleCards.length === 0} style={primaryPillStyle}>
            {busy ? 'Generating…' : 'Generate'}
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

const folderListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 180,
  overflow: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2)'
}

const folderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--font-sm)',
  fontWeight: 400,
  padding: '4px 2px',
  cursor: 'pointer'
}
