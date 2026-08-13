import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GenerationComplexity } from '../../../../shared/types'
import { useUiStore } from '../../state/uiStore'

/** A small popover for the AI-generation knobs (complexity, split, custom prompt, cloze,
 *  double-sided) — shared by every creation surface (PDF/PPTX viewer, video OCR flow, combine
 *  basket) via the same uiStore slice, so changing a setting in one place applies everywhere. */
export function GenerationSettingsPanel(): JSX.Element {
  const settings = useUiStore((s) => s.generationSettings)
  const update = useUiStore((s) => s.updateGenerationSettings)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [open])

  const nonDefault =
    settings.complexity !== 'standard' || settings.splitIntoMultiple || !!settings.customPrompt || settings.cloze || settings.doubleSided

  return (
    <div style={{ position: 'relative' }} ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="AI generation settings"
        style={{
          border: open || nonDefault ? '1px solid var(--accent)' : '1px solid transparent',
          background: open || nonDefault ? 'var(--accent-soft)' : 'transparent',
          color: open || nonDefault ? 'var(--accent)' : 'var(--fg-muted)'
        }}
      >
        ⚙️ Generation{nonDefault ? ' •' : ''}
      </button>

      {open && (
        <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
          <label style={rowStyle}>
            <span style={labelStyle}>Complexity</span>
            <select
              value={settings.complexity}
              onChange={(e) => update({ complexity: e.target.value as GenerationComplexity })}
              style={selectStyle}
            >
              <option value="simple">Simple</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.splitIntoMultiple}
              onChange={(e) => update({ splitIntoMultiple: e.target.checked })}
            />
            <span>Split selection into separate cards</span>
          </label>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.cloze}
              onChange={(e) => update({ cloze: e.target.checked, doubleSided: e.target.checked ? false : settings.doubleSided })}
            />
            <span>Cloze deletion (fill-in-the-blank)</span>
          </label>

          <label style={{ ...checkboxRowStyle, opacity: settings.cloze ? 0.4 : 1 }}>
            <input
              type="checkbox"
              checked={settings.doubleSided}
              disabled={settings.cloze}
              onChange={(e) => update({ doubleSided: e.target.checked })}
            />
            <span>Double-sided (also make a reversed card)</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Custom prompt (replaces the default instruction)</span>
            <textarea
              value={settings.customPrompt ?? ''}
              onChange={(e) => update({ customPrompt: e.target.value.trim() ? e.target.value : null })}
              placeholder="e.g. Write the answer as a numbered list of steps."
              rows={2}
              style={textareaStyle}
            />
          </label>

          {nonDefault && (
            <button
              onClick={() => update({ complexity: 'standard', splitIntoMultiple: false, customPrompt: null, cloze: false, doubleSided: false })}
              style={resetButtonStyle}
            >
              Reset to defaults
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  width: 260,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 'var(--space-3)',
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 24px #00000030',
  zIndex: 20,
  animation: 'pop-in 150ms ease'
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8
}

const checkboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--font-sm)',
  cursor: 'pointer'
}

const labelStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  color: 'var(--fg-muted)'
}

const selectStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '3px 6px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit'
}

const textareaStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '4px 6px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  resize: 'vertical',
  fontFamily: 'inherit'
}

const resetButtonStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-muted)',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  padding: 0
}
