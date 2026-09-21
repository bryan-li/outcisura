import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { backLinesToText, backTextToLines, CARD_DELIMITER, type BackLine } from '../../utils/blockCard'

const LINE_HEIGHT = 22
const MAX_DEPTH = 4

/** A textarea that grows to fit its text and is styled by its parent to look exactly like the
 *  rendered text it replaces — no box, no border, so editing doesn't reflow anything. */
function AutoText({
  value,
  onChange,
  onKeyDown,
  onPaste,
  placeholder,
  style,
  inputRef
}: {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  style: CSSProperties
  inputRef: (el: HTMLTextAreaElement | null) => void
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        inputRef(el)
      }}
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      style={{ ...baseFieldStyle, ...style }}
    />
  )
}

interface Props {
  front: string
  back: string
  isCloze: boolean
  /** Called once when focus leaves the editor (or on Escape) with the cleaned-up result. */
  onCommit: (result: { front: string; back: string }) => void
}

/** Edits a card in place: the question is bold and the answer points are a bulleted list, laid out
 *  the same as the card's read-only view, so opening the editor doesn't change how anything looks.
 *  Enter adds a bullet, Tab / Shift+Tab indent and outdent, Backspace on an empty bullet removes it,
 *  and typing ":>" in the question moves the rest into the first bullet (the old block syntax). */
export function CardInlineEditor({ front, back, isCloze, onCommit }: Props): JSX.Element {
  const [frontText, setFrontText] = useState(front)
  const [lines, setLines] = useState<BackLine[]>(() => {
    const parsed = backTextToLines(back)
    return parsed.length > 0 ? parsed : [{ depth: 0, text: '' }]
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const frontRef = useRef<HTMLTextAreaElement | null>(null)
  const lineRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const pendingFocus = useRef<{ index: number; caret: number | 'end' } | null>(null)
  const committed = useRef(false)

  useEffect(() => {
    const el = frontRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [])

  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const el = target.index < 0 ? frontRef.current : lineRefs.current[target.index]
    if (!el) return
    el.focus()
    const pos = target.caret === 'end' ? el.value.length : target.caret
    el.setSelectionRange(pos, pos)
  })

  function commit(currentFront: string, currentLines: BackLine[]): void {
    if (committed.current) return
    committed.current = true
    const cleaned = currentLines.filter((l) => l.text.trim().length > 0).map((l) => ({ depth: l.depth, text: l.text.trim() }))
    onCommit({ front: currentFront.trim(), back: backLinesToText(cleaned) })
  }

  function handleBlur(): void {
    // Focus moving between this editor's own fields isn't leaving it.
    requestAnimationFrame(() => {
      if (rootRef.current && !rootRef.current.contains(document.activeElement)) commit(frontText, lines)
    })
  }

  function updateLine(index: number, patch: Partial<BackLine>): void {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function handleFrontChange(value: string): void {
    if (!isCloze && value.includes(CARD_DELIMITER)) {
      const at = value.indexOf(CARD_DELIMITER)
      const rest = value.slice(at + CARD_DELIMITER.length).trim()
      setFrontText(value.slice(0, at).trimEnd())
      setLines((prev) => {
        if (prev.length === 1 && prev[0].text === '') return [{ depth: 0, text: rest }]
        return [{ depth: 0, text: rest }, ...prev]
      })
      pendingFocus.current = { index: 0, caret: 'end' }
      return
    }
    setFrontText(value)
  }

  function handleFrontKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      commit(frontText, lines)
    } else if (!isCloze && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      pendingFocus.current = { index: 0, caret: 0 }
      setLines((prev) => [...prev]) // re-render so the pending focus runs
    } else if (!isCloze && e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      e.preventDefault()
      lineRefs.current[0]?.focus()
    }
  }

  function handleLineKey(index: number, e: KeyboardEvent<HTMLTextAreaElement>): void {
    const el = e.currentTarget
    const line = lines[index]
    if (e.key === 'Escape') {
      e.preventDefault()
      commit(frontText, lines)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (line.text === '' && index > 0) {
        // Enter on an empty bullet steps out a level, or ends the list at the top level.
        if (line.depth > 0) updateLine(index, { depth: line.depth - 1 })
        else {
          setLines((prev) => prev.filter((_, i) => i !== index))
          pendingFocus.current = { index: index - 1, caret: 'end' }
        }
        return
      }
      const before = el.value.slice(0, el.selectionStart)
      const after = el.value.slice(el.selectionEnd)
      setLines((prev) => [...prev.slice(0, index), { ...line, text: before }, { depth: line.depth, text: after }, ...prev.slice(index + 1)])
      pendingFocus.current = { index: index + 1, caret: 0 }
    } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (index === 0) {
        if (line.text === '' && lines.length === 1) return
        e.preventDefault()
        if (line.depth > 0) updateLine(index, { depth: line.depth - 1 })
        else pendingFocus.current = { index: -1, caret: 'end' }
        if (pendingFocus.current) setLines((prev) => [...prev])
        return
      }
      e.preventDefault()
      if (line.depth > 0) {
        updateLine(index, { depth: line.depth - 1 })
      } else {
        const prevLine = lines[index - 1]
        setLines((prev) => [...prev.slice(0, index - 1), { ...prevLine, text: prevLine.text + line.text }, ...prev.slice(index + 1)])
        pendingFocus.current = { index: index - 1, caret: prevLine.text.length }
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const depth = e.shiftKey ? Math.max(0, line.depth - 1) : Math.min(MAX_DEPTH, line.depth + 1)
      updateLine(index, { depth })
    } else if (e.key === 'ArrowUp' && el.selectionStart === 0) {
      e.preventDefault()
      const target = index === 0 ? frontRef.current : lineRefs.current[index - 1]
      target?.focus()
    } else if (e.key === 'ArrowDown' && el.selectionStart === el.value.length && index < lines.length - 1) {
      e.preventDefault()
      lineRefs.current[index + 1]?.focus()
    }
  }

  function handleLinePaste(index: number, e: ClipboardEvent<HTMLTextAreaElement>): void {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    const el = e.currentTarget
    const pasted = text.split('\n').map((t) => t.replace(/^\s*[•\-*]\s*/, '').trim()).filter(Boolean)
    if (pasted.length === 0) return
    const line = lines[index]
    const before = el.value.slice(0, el.selectionStart)
    const after = el.value.slice(el.selectionEnd)
    const inserted: BackLine[] = pasted.map((t, i) => ({ depth: line.depth, text: i === 0 ? before + t : t }))
    inserted[inserted.length - 1].text += after
    setLines((prev) => [...prev.slice(0, index), ...inserted, ...prev.slice(index + 1)])
    pendingFocus.current = { index: index + inserted.length - 1, caret: 'end' }
  }

  return (
    <div ref={rootRef} onBlur={handleBlur} style={editorWrapStyle}>
      <AutoText
        value={frontText}
        onChange={handleFrontChange}
        onKeyDown={handleFrontKey}
        placeholder={isCloze ? 'Wrap the hidden answer in {{double braces}}' : 'Question'}
        inputRef={(el) => {
          frontRef.current = el
        }}
        style={isCloze ? clozeFieldStyle : frontFieldStyle}
      />
      {!isCloze && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {lines.map((line, i) => (
            <li key={i} style={{ marginLeft: line.depth * 16, fontSize: 'var(--font-md)' }}>
              <AutoText
                value={line.text}
                onChange={(text) => updateLine(i, { text })}
                onKeyDown={(e) => handleLineKey(i, e)}
                onPaste={(e) => handleLinePaste(i, e)}
                placeholder={i === 0 ? 'Answer' : undefined}
                inputRef={(el) => {
                  lineRefs.current[i] = el
                }}
                style={lineFieldStyle}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const baseFieldStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  padding: 0,
  margin: 0,
  resize: 'none',
  overflow: 'hidden',
  lineHeight: `${LINE_HEIGHT}px`
}

const frontFieldStyle: CSSProperties = { fontSize: 'var(--font-md)', fontWeight: 700 }
const clozeFieldStyle: CSSProperties = { fontSize: 'var(--font-md)', fontWeight: 400 }
const lineFieldStyle: CSSProperties = { fontSize: 'var(--font-md)', fontWeight: 400 }

/** A faint wash marks the block as being edited without adding any border or padding that would
 *  shift the text (the negative margin cancels the padding). */
const editorWrapStyle: CSSProperties = {
  margin: '-2px -6px',
  padding: '2px 6px',
  borderRadius: 'var(--radius-row)',
  background: 'color-mix(in srgb, var(--accent) 7%, transparent)'
}
