import Anthropic from '@anthropic-ai/sdk'
import { app } from 'electron'
import { readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createWorker } from 'tesseract.js'
import type { OcrDetection, OcrEngine } from '../shared/types'
import { imageMediaType } from './imageUtils'

let ocrCacheDir: string | null = null

/** Without an explicit cachePath, tesseract.js writes eng.traineddata into process.cwd() — the
 *  project root in dev, and an inappropriate (possibly read-only) location in a packaged build.
 *  Scoped under userData, matching every other on-disk store in this app (imageStore/videoStore). */
function getOcrCacheDir(): string {
  if (!ocrCacheDir) {
    ocrCacheDir = join(app.getPath('userData'), 'ocr-cache')
    mkdirSync(ocrCacheDir, { recursive: true })
  }
  return ocrCacheDir
}

const MODEL = 'claude-sonnet-5'

// claude-sonnet-5 is on the high-resolution vision tier ("Claude 4.7 and later models" per
// Anthropic's current tier table) — 2576px max edge, 4784 max visual tokens. Getting either
// constant wrong silently shifts every coordinate Claude returns, with no error raised, since we
// rescale mathematically rather than pre-resizing the image ourselves (see rescaleToOriginal).
const CLAUDE_VISION_MAX_EDGE = 2576
const CLAUDE_VISION_MAX_TOKENS = 4784

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report_text_regions',
  description: 'Report every distinct piece of readable text visible in the image, each with its bounding box.',
  input_schema: {
    type: 'object',
    properties: {
      regions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The exact text in this region, verbatim.' },
            x: { type: 'number', description: 'Left edge, absolute pixel coordinate in the image as shown to you.' },
            y: { type: 'number', description: 'Top edge, absolute pixel coordinate.' },
            width: { type: 'number', description: 'Width in pixels.' },
            height: { type: 'number', description: 'Height in pixels.' }
          },
          required: ['text', 'x', 'y', 'width', 'height']
        }
      }
    },
    required: ['regions']
  }
}

interface RawRegion {
  text: string
  x: number
  y: number
  width: number
  height: number
}

/** Generic OCR, behind one entry point regardless of engine — separate from AiService since it has
 *  different response-parsing (forced tool-use vs. AiService's prose regex), different failure
 *  semantics (must keep working with no API key at all; Tesseract is a real fallback, not a
 *  degraded mode), and no Repository dependency (the IPC handler persists results, this just
 *  returns detections). */
export class OcrService {
  private client: Anthropic | null

  constructor(apiKey: string | null) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null
  }

  /** Called when the user sets/changes/clears the key from Settings — takes effect immediately,
   *  no restart needed. */
  setApiKey(apiKey: string | null): void {
    this.client = apiKey ? new Anthropic({ apiKey }) : null
  }

  async recognize(
    imagePath: string,
    engine: OcrEngine,
    originalDims: { width: number; height: number }
  ): Promise<OcrDetection[]> {
    if (engine === 'tesseract') return this.recognizeWithTesseract(imagePath)
    return this.recognizeWithClaude(imagePath, originalDims)
  }

  private async recognizeWithTesseract(imagePath: string): Promise<OcrDetection[]> {
    const worker = await createWorker('eng', undefined, { cachePath: getOcrCacheDir() })
    try {
      // `blocks` isn't included in the output by default (tesseract.js v7) — request it explicitly
      // or `data.blocks` comes back null. Words are nested blocks→paragraphs→lines→words, not a
      // flat data.words array.
      const { data } = await worker.recognize(imagePath, {}, { blocks: true })
      const words = (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((para) => para.lines.flatMap((line) => line.words))
      )
      // Confidence <30 was too strict in practice — real video frames (compression, motion, small
      // on-screen text) routinely score lower than clean rendered text, and a too-strict cutoff
      // silently drops every word rather than surfacing a few low-confidence ones the user can
      // just not select. Only drop genuinely blank OCR noise.
      return words
        .filter((w) => w.text.trim() && w.confidence > 0)
        .map((w) => ({
          text: w.text,
          bbox: { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 }
        }))
    } finally {
      await worker.terminate()
    }
  }

  private async recognizeWithClaude(
    imagePath: string,
    originalDims: { width: number; height: number }
  ): Promise<OcrDetection[]> {
    if (!this.client) throw new Error('Claude Vision OCR unavailable: set ANTHROPIC_API_KEY')

    const data = readFileSync(imagePath).toString('base64')
    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: 'report_text_regions' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageMediaType(imagePath), data } },
            {
              type: 'text',
              text: [
                'Identify every distinct piece of readable text in this image.',
                'Box each word or short contiguous phrase separately, the way a reader would drag-select',
                'individual words — do not merge a whole sentence or paragraph into one box.',
                'Report bounding boxes as absolute pixel coordinates in the image as shown to you',
                '(top-left corner x/y, plus width/height in pixels) — not normalized 0-1000 coordinates.'
              ].join(' ')
            }
          ]
        }
      ]
    })

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'report_text_regions'
    )
    if (!toolUse) throw new Error('Claude Vision OCR did not return structured regions')

    const regions = parseRegions(toolUse.input)
    return regions.map((r) => ({ text: r.text, bbox: rescaleToOriginal(r, originalDims) }))
  }
}

/** Hand-rolled validation, not a schema library — this codebase has no zod/ajv dependency, and this
 *  matches the existing defensive-parsing style already used for AiService's own prose response. */
function parseRegions(input: unknown): RawRegion[] {
  if (typeof input !== 'object' || input === null || !('regions' in input)) {
    throw new Error('Malformed OCR tool response: missing regions')
  }
  const regions = (input as { regions: unknown }).regions
  if (!Array.isArray(regions)) throw new Error('Malformed OCR tool response: regions is not an array')
  return regions.filter(
    (r): r is RawRegion =>
      typeof r === 'object' &&
      r !== null &&
      typeof r.text === 'string' &&
      typeof r.x === 'number' &&
      typeof r.y === 'number' &&
      typeof r.width === 'number' &&
      typeof r.height === 'number'
  )
}

/** The size Claude resizes an image to before processing (aspect-preserving, fit to both the edge
 *  and visual-token limits) — ported from Anthropic's documented reference implementation. Padding
 *  (applied after this, bottom/right only) is content-free and doesn't shift the origin, so it's
 *  not needed for the inverse scale below. */
function resizedDims(width: number, height: number): { width: number; height: number } {
  const edgeScale = Math.min(1, CLAUDE_VISION_MAX_EDGE / Math.max(width, height))
  let w = width * edgeScale
  let h = height * edgeScale
  const tokens = Math.ceil(w / 28) * Math.ceil(h / 28)
  if (tokens > CLAUDE_VISION_MAX_TOKENS) {
    const tokenScale = Math.sqrt(CLAUDE_VISION_MAX_TOKENS / tokens)
    w *= tokenScale
    h *= tokenScale
  }
  return { width: w, height: h }
}

function rescaleToOriginal(
  region: { x: number; y: number; width: number; height: number },
  original: { width: number; height: number }
): { x: number; y: number; w: number; h: number } {
  const seen = resizedDims(original.width, original.height)
  const scaleX = original.width / seen.width
  const scaleY = original.height / seen.height
  return { x: region.x * scaleX, y: region.y * scaleY, w: region.width * scaleX, h: region.height * scaleY }
}
