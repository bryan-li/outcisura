import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import type {
  AiJudgeFreeTextRequest,
  AiJudgeFreeTextResult,
  AiRegenerateRequest,
  AiRegenerateResult,
  AiSharePrepRequest,
  AiSharePrepResult,
  GenerationComplexity,
  ShareFormat
} from '../shared/types'
import { Repository } from './db/repository'
import { imageMediaType } from './imageUtils'

const MODEL = 'claude-sonnet-5'

type ContentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam

export class AiService {
  private client: Anthropic | null

  constructor(apiKey: string | null, private repo: Repository) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null
  }

  /** Called when the user sets/changes/clears the key from Settings — takes effect immediately,
   *  no restart needed, mirroring OcrService's own setApiKey. */
  setApiKey(apiKey: string | null): void {
    this.client = apiKey ? new Anthropic({ apiKey }) : null
  }

  async regenerate(req: AiRegenerateRequest): Promise<AiRegenerateResult> {
    if (!this.client) throw new Error('AI service unavailable: set an API key in Settings')
    const client = this.client

    const content: ContentBlock[] = [{ type: 'text', text: this.buildPrompt(req) }]

    // A source carries its own image directly (screenshot-cropped occlusion sources) or, failing
    // that, falls back to whatever parsed element it points at. Dedupe by path: a grouped occlusion
    // card has several sources sharing the same underlying image, and there's no reason to attach it
    // more than once. Sources' pageId/elementId still resolve against the local repo here — pages/
    // elements/images stay fully local regardless of where the card itself lives (see cloud-sync
    // plan's scope revision), so this part is unaffected by cards moving to Supabase.
    const imagePaths = new Set<string>()
    for (const source of req.sources) {
      const imagePath = source.imagePath ?? (source.pageId ? this.lookupElementImagePath(source.pageId, source.elementId) : null)
      if (imagePath) imagePaths.add(imagePath)
    }
    for (const imagePath of imagePaths) {
      content.push(...this.imageBlocks(imagePath))
    }

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content }]
    })

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    return this.parseResponse(text, req.cloze ?? false)
  }

  /** Live-session "share-ready" prep (Phase 1) — given a card's front/back, produces a recommended
   *  question format plus content for BOTH formats regardless of which one's recommended (3 MCQ
   *  distractors, a free-text judging rubric), so a host's per-card format override in the session
   *  setup screen never needs a fresh AI call. Unlike regenerate()'s labeled-plain-text/regex
   *  convention, this responds in JSON — the multi-field shape (an enum, a fixed-length array, and
   *  a second string) has no natural line-based delimiter the way two flat strings do, and
   *  `JSON.parse` + a shape check is exact where multi-regex parsing would be fragile. Not using
   *  Anthropic tool-use/forced-schema mode: that's real additional machinery that would only start
   *  paying for itself once there's a second structured-output call type in this file. */
  async prepareForSharing(req: AiSharePrepRequest): Promise<AiSharePrepResult> {
    if (!this.client) throw new Error('AI service unavailable: set an API key in Settings')

    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: this.buildSharePrepPrompt(req) }]
    })

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    return this.parseSharePrepResponse(text)
  }

  private buildSharePrepPrompt(req: AiSharePrepRequest): string {
    return [
      'You are preparing a study flashcard for a live multiplayer quiz session.',
      `Front: ${req.front}`,
      `Back: ${req.back}`,
      '',
      'Decide which quiz format fits this card best:',
      '- "mcq" — the back is a short, discrete fact with clearly wrong alternatives (a single term, date, name, or value).',
      '- "free_text" — the back is open-ended, a list, or an explanation that doesn\'t reduce to one short phrase.',
      '',
      'Regardless of which format you recommend, produce content for BOTH, since a host may override your choice:',
      '- Exactly 3 multiple-choice distractors: plausible-sounding but definitely wrong answers, in the same style/length as the real answer, none of them a paraphrase of it.',
      '- A short free-text judging rubric: 1-2 sentences describing what a correct answer must contain, for another AI pass to grade a typed response against later.',
      '',
      'Respond with ONLY a single JSON object, no markdown code fences, no commentary before or after:',
      '{"format": "mcq" | "free_text", "distractors": ["...", "...", "..."], "rubric": "..."}'
    ].join('\n')
  }

  private parseSharePrepResponse(text: string): AiSharePrepResult {
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(`Could not parse AI share-prep response as JSON: ${text}`)
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`AI share-prep response was not a JSON object: ${text}`)
    }
    const { format, distractors, rubric } = parsed as Record<string, unknown>
    if (format !== 'mcq' && format !== 'free_text') {
      throw new Error(`AI share-prep response had an invalid format: ${text}`)
    }
    if (!Array.isArray(distractors) || distractors.length !== 3 || distractors.some((d) => typeof d !== 'string' || !d.trim())) {
      throw new Error(`AI share-prep response did not have exactly 3 non-empty distractors: ${text}`)
    }
    if (typeof rubric !== 'string' || !rubric.trim()) {
      throw new Error(`AI share-prep response had an empty rubric: ${text}`)
    }
    return { recommendedFormat: format as ShareFormat, mcqDistractors: distractors as string[], freeTextRubric: rubric.trim() }
  }

  /** Batched free-text grading for one live-session question — every submitted answer judged
   *  against the same cached rubric in a single call, not one call per answer (this is exactly the
   *  "second structured-output call type" prepareForSharing's own docblock flagged as worth
   *  reconsidering tool-use for — sticking with the same JSON-in-text-block convention anyway,
   *  since switching now would fragment the codebase over one call site for no real benefit). Runs
   *  only on the host's machine (live sessions can't exist without a connected host), never called
   *  from a guest's client. */
  async judgeFreeTextAnswers(req: AiJudgeFreeTextRequest): Promise<AiJudgeFreeTextResult> {
    if (!this.client) throw new Error('AI service unavailable: set an API key in Settings')
    if (req.answers.length === 0) return { judgments: [] }

    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1536,
      messages: [{ role: 'user', content: this.buildJudgePrompt(req) }]
    })

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    return this.parseJudgeResponse(text, req.answers.map((a) => a.answerId))
  }

  private buildJudgePrompt(req: AiJudgeFreeTextRequest): string {
    const answerLines = req.answers.map((a) => `{"answerId": ${JSON.stringify(a.answerId)}, "text": ${JSON.stringify(a.text)}}`).join(',\n  ')
    return [
      'You are grading free-text answers submitted during a live quiz, against one rubric.',
      `Rubric (what a correct answer must contain): ${req.rubric}`,
      '',
      'Answers to grade:',
      `[\n  ${answerLines}\n]`,
      '',
      'For each answer, decide if it satisfies the rubric well enough to count as correct — be reasonably',
      'lenient about phrasing/typos, but strict about missing the actual required content.',
      '',
      'Respond with ONLY a single JSON object, no markdown code fences, no commentary before or after,',
      'with exactly one judgment per answer above, in any order:',
      '{"judgments": [{"answerId": "...", "isCorrect": true | false}, ...]}'
    ].join('\n')
  }

  private parseJudgeResponse(text: string, expectedAnswerIds: string[]): AiJudgeFreeTextResult {
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(`Could not parse AI judging response as JSON: ${text}`)
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`AI judging response was not a JSON object: ${text}`)
    }
    const { judgments } = parsed as Record<string, unknown>
    if (!Array.isArray(judgments)) {
      throw new Error(`AI judging response had no judgments array: ${text}`)
    }
    const byId = new Map<string, boolean>()
    for (const j of judgments) {
      if (typeof j !== 'object' || j === null) continue
      const { answerId, isCorrect } = j as Record<string, unknown>
      if (typeof answerId === 'string' && typeof isCorrect === 'boolean') byId.set(answerId, isCorrect)
    }
    const missing = expectedAnswerIds.filter((id) => !byId.has(id))
    if (missing.length > 0) {
      throw new Error(`AI judging response is missing judgments for: ${missing.join(', ')}. Raw: ${text}`)
    }
    return { judgments: expectedAnswerIds.map((answerId) => ({ answerId, isCorrect: byId.get(answerId)! })) }
  }

  private buildPrompt(req: AiRegenerateRequest): string {
    const sourceDescriptions = req.sources
      .map((s, i) => `Source ${i + 1} (${s.label}): see attached content`)
      .join('\n')

    return [
      'You are helping write a study flashcard from highlighted source material.',
      `Current front: ${req.front || '(empty)'}`,
      `Current back: ${req.back || '(empty)'}`,
      req.sources.length > 0 ? `Sources:\n${sourceDescriptions}` : '',
      // A custom prompt REPLACES the default instruction below entirely — it's meant as "ignore
      // my usual phrasing, do exactly this instead," not one more note piled onto the defaults.
      req.instruction ? `User instruction: ${req.instruction}` : '',
      '',
      ...(req.instruction ? [] : this.defaultInstructions(req.complexity)),
      req.cloze
        ? [
            'Respond in exactly this format, no extra commentary:',
            'CLOZE: <one passage, with the key term(s) to hide wrapped in double curly braces, e.g. "The mitochondria is the {{powerhouse}} of the cell.">'
          ].join('\n')
        : ['Respond in exactly this format, no extra commentary:', 'FRONT: <question>', 'BACK: <answer, one or more lines>'].join('\n')
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** Skipped entirely when a custom prompt is set — see buildPrompt. */
  private defaultInstructions(complexity?: GenerationComplexity): string[] {
    const lines = ['Rewrite this as a single clear, focused flashcard.']
    if (complexity === 'simple') {
      lines.push('Keep it simple: a short, single-fact question with a brief, one-line answer — suitable for a first pass, not deep mastery.')
    } else if (complexity === 'detailed') {
      lines.push(
        'Go deeper than a surface-level fact: include relevant nuance, context, or an edge case in the answer where the source material supports it. Keep the front to one clear question even so — depth belongs in the answer, not a compound question.'
      )
    }
    lines.push(
      'If the answer is naturally a set of discrete items (causes, symptoms, steps, criteria, etc.), phrase the front as a question ending with the count in parentheses — e.g. "What are the causes of X? (3)" — and write the back as exactly that many bullet points, one per line, each starting with "• ". Otherwise (a single fact or definition), keep the back as plain prose — don\'t force a list where there isn\'t one.'
    )
    return lines
  }

  private lookupElementImagePath(pageId: string, elementId: string | null): string | null {
    if (!elementId) return null
    const element = this.repo.getElements(pageId).find((e) => e.id === elementId)
    return element?.imagePath ?? null
  }

  private imageBlocks(imagePath: string): ContentBlock[] {
    const data = readFileSync(imagePath).toString('base64')
    return [
      {
        type: 'image',
        source: { type: 'base64', media_type: imageMediaType(imagePath), data }
      }
    ]
  }

  private parseResponse(text: string, cloze: boolean): AiRegenerateResult {
    if (cloze) {
      // Everything after "CLOZE:", not just the first line — a longer passage can wrap. `back`
      // stays empty: a cloze card's masked/revealed states are both derived from `front`'s own
      // {{}} markup at render time (see renderer/src/utils/cloze.ts), there's nothing separate to
      // put in `back`.
      const clozeIndex = text.search(/CLOZE:/i)
      if (clozeIndex === -1) throw new Error(`Could not parse AI cloze response: ${text}`)
      const front = text
        .slice(clozeIndex)
        .replace(/^CLOZE:\s*/i, '')
        .trim()
      if (!/\{\{.+?\}\}/.test(front)) throw new Error(`AI cloze response has no {{blank}}: ${text}`)
      return { front, back: '' }
    }

    const frontMatch = /FRONT:\s*(.+)/i.exec(text)
    const backIndex = text.search(/BACK:/i)
    if (!frontMatch || backIndex === -1) {
      throw new Error(`Could not parse AI response: ${text}`)
    }
    // Everything after "BACK:" to the end of the response, not just its first line — a bulleted,
    // multi-point answer spans several lines and a single-line match would silently drop the rest.
    const back = text
      .slice(backIndex)
      .replace(/^BACK:\s*/i, '')
      .trim()
    return { front: frontMatch[1].trim(), back }
  }
}
