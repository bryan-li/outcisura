import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ParsedDocument, ParsedElement, ParsedPage } from '../../../shared/types'
import type { ImportProgressCallback } from '../types/importProgress'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** Render scale for the cached page image. Higher = crisper zoom, bigger files. */
const RENDER_SCALE = 2

const { OPS } = pdfjsLib

export async function parsePdf(file: File, onProgress?: ImportProgressCallback): Promise<ParsedDocument> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise

  const pages: ParsedPage[] = []
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex + 1)
    pages.push(await parsePage(page, pageIndex))
    onProgress?.({ phase: 'parsing', current: pageIndex + 1, total: pdf.numPages })
  }

  return { filename: file.name, type: 'pdf', pages }
}

async function parsePage(
  page: pdfjsLib.PDFPageProxy,
  pageIndex: number
): Promise<ParsedPage> {
  const viewport = page.getViewport({ scale: RENDER_SCALE })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport }).promise
  const backgroundImage = canvas.toDataURL('image/png')

  const textElements = await extractTextElements(page, viewport)
  const opList = await page.getOperatorList()
  const imageElements = await resolveImageElements(opList, viewport, canvas)

  return {
    pageIndex,
    width: viewport.width,
    height: viewport.height,
    backgroundImage,
    elements: [...textElements, ...imageElements]
  }
}

const DEFAULT_ASCENT = 0.8
const DEFAULT_DESCENT = -0.2

async function extractTextElements(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport
): Promise<ParsedElement[]> {
  const textContent = await page.getTextContent()
  const elements: ParsedElement[] = []

  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue

    // pdf.js hands us one item per content-stream text-show op, which is often a whole line
    // (LibreOffice draws entire lines as a single op) — split into per-word boxes so highlighting
    // a slide is specific to a word/phrase rather than the full line, and pick font-metric-based
    // ascent/descent instead of the full em box so the box hugs the glyphs rather than the line leading.
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
    const scaleX = Math.hypot(tx[0], tx[1])
    const fontHeight = Math.hypot(tx[2], tx[3])
    // A degenerate (zero-size) transform — e.g. an invisible/zero-width text run — would make the
    // direction vectors below divide by zero into NaN, which propagates into an invalid, invisible,
    // or wildly-placed box. Nothing meaningful to box here, so skip it.
    if (scaleX === 0 || fontHeight === 0) continue

    const sourceScaleX = Math.hypot(item.transform[0], item.transform[1]) || 1
    const totalWidth = (item.width * scaleX) / sourceScaleX
    // Unit vector along the baseline (text advance direction) and perpendicular "up" (toward
    // ascenders), both already in viewport pixel space — correct for any page/text rotation, not
    // just the common horizontal case.
    const dirX = tx[0] / scaleX
    const dirY = tx[1] / scaleX
    const upX = tx[2] / fontHeight
    const upY = tx[3] / fontHeight

    const style = textContent.styles[item.fontName]
    const ascent = style && Number.isFinite(style.ascent) ? style.ascent : DEFAULT_ASCENT
    const descent = style && Number.isFinite(style.descent) ? style.descent : DEFAULT_DESCENT
    const ascentPx = fontHeight * ascent
    const descentPx = fontHeight * -descent // descent is negative; this is a positive magnitude

    for (const word of splitIntoWords(item.str)) {
      const startFrac = word.start / item.str.length
      const endFrac = word.end / item.str.length
      const startOffset = startFrac * totalWidth
      const endOffset = Math.max(endFrac * totalWidth, startOffset + 1)

      // The word occupies a (possibly rotated) rectangle: two points along the baseline, each
      // extended by ascent/descent along the perpendicular axis. Take the axis-aligned bounding
      // box of all four corners rather than assuming "up" means "-y" — a word rotated with its
      // slide label/callout has a baseline that isn't horizontal, and offsetting only along a
      // fixed vertical axis walks the box progressively off the real diagonal line.
      const baseX1 = tx[4] + dirX * startOffset
      const baseY1 = tx[5] + dirY * startOffset
      const baseX2 = tx[4] + dirX * endOffset
      const baseY2 = tx[5] + dirY * endOffset
      const corners = [
        [baseX1 + upX * ascentPx, baseY1 + upY * ascentPx],
        [baseX2 + upX * ascentPx, baseY2 + upY * ascentPx],
        [baseX1 - upX * descentPx, baseY1 - upY * descentPx],
        [baseX2 - upX * descentPx, baseY2 - upY * descentPx]
      ]
      const xs = corners.map((c) => c[0])
      const ys = corners.map((c) => c[1])
      const x = Math.min(...xs)
      const y = Math.min(...ys)

      elements.push({
        kind: 'text',
        text: word.text,
        bbox: {
          x,
          y,
          w: Math.max(Math.max(...xs) - x, 1),
          h: Math.max(Math.max(...ys) - y, 1)
        }
      })
    }
  }

  return elements
}

interface WordSpan {
  text: string
  start: number
  end: number
}

function splitIntoWords(str: string): WordSpan[] {
  const words: WordSpan[] = []
  const re = /\S+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(str))) {
    words.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  return words
}

interface RawImageBox {
  x: number
  y: number
  w: number
  h: number
}

type OperatorList = Awaited<ReturnType<pdfjsLib.PDFPageProxy['getOperatorList']>>

async function resolveImageElements(
  opList: OperatorList,
  viewport: pdfjsLib.PageViewport,
  pageCanvas: HTMLCanvasElement
): Promise<ParsedElement[]> {
  const boxes = collectImageBoxes(opList, viewport)
  return boxes.map((box) => ({
    kind: 'image' as const,
    bbox: box,
    imageData: cropCanvas(pageCanvas, box)
  }))
}

function collectImageBoxes(opList: OperatorList, viewport: pdfjsLib.PageViewport): RawImageBox[] {
  const { fnArray, argsArray } = opList
  const boxes: RawImageBox[] = []
  const stack: number[][] = []
  let ctm: number[] = [1, 0, 0, 1, 0, 0]

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    switch (fn) {
      case OPS.save:
        stack.push(ctm)
        break
      case OPS.restore:
        ctm = stack.pop() ?? ctm
        break
      case OPS.transform:
        ctm = pdfjsLib.Util.transform(ctm, argsArray[i] as number[])
        break
      case OPS.paintFormXObjectBegin: {
        // Pictures/shapes are frequently wrapped in their own Form XObject (LibreOffice does this
        // heavily for grouping/clipping). Its matrix must be folded into the CTM like save+transform,
        // or images inside one inherit the *outer* transform and end up sized/positioned wrong
        // (commonly: covering the whole page).
        stack.push(ctm)
        const [matrix] = argsArray[i] as [number[] | null, unknown]
        if (matrix) ctm = pdfjsLib.Util.transform(ctm, matrix)
        break
      }
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm
        break
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        const combined = pdfjsLib.Util.transform(viewport.transform, ctm)
        const corners = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1]
        ].map(([x, y]) => pdfjsLib.Util.applyTransform([x, y], combined))
        const xs = corners.map((c) => c[0])
        const ys = corners.map((c) => c[1])
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        const w = Math.max(...xs) - x
        const h = Math.max(...ys) - y
        if (w > 2 && h > 2) boxes.push({ x, y, w, h })
        break
      }
    }
  }

  return boxes
}

function cropCanvas(source: HTMLCanvasElement, box: RawImageBox): string {
  const crop = document.createElement('canvas')
  crop.width = Math.max(1, Math.round(box.w))
  crop.height = Math.max(1, Math.round(box.h))
  const ctx = crop.getContext('2d')!
  ctx.drawImage(
    source,
    box.x,
    box.y,
    box.w,
    box.h,
    0,
    0,
    crop.width,
    crop.height
  )
  return crop.toDataURL('image/png')
}
