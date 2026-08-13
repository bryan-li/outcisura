import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import type { AiRegenerateRequest, AiRegenerateResult, CardRecord, GenerationComplexity } from '../shared/types'
import { Repository } from './db/repository'
import { imageMediaType } from './imageUtils'

const MODEL = 'claude-sonnet-5'

type ContentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam

export class AiService {
  private client: Anthropic

  constructor(apiKey: string, private repo: Repository) {
    this.client = new Anthropic({ apiKey })
  }

  async regenerate(req: AiRegenerateRequest): Promise<AiRegenerateResult> {
    const card = this.repo.getCard(req.cardId)
    if (!card) throw new Error(`Card ${req.cardId} not found`)

    const content: ContentBlock[] = [{ type: 'text', text: this.buildPrompt(card, req) }]

    // A source carries its own image directly (screenshot-cropped occlusion sources) or, failing
    // that, falls back to whatever parsed element it points at. Dedupe by path: a grouped occlusion
    // card has several sources sharing the same underlying image, and there's no reason to attach it
    // more than once.
    const imagePaths = new Set<string>()
    for (const source of card.sources) {
      const imagePath = source.imagePath ?? this.lookupElementImagePath(source.pageId, source.elementId)
      if (imagePath) imagePaths.add(imagePath)
    }
    for (const imagePath of imagePaths) {
      content.push(...this.imageBlocks(imagePath))
    }

    const message = await this.client.messages.create({
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

  private buildPrompt(card: CardRecord, req: AiRegenerateRequest): string {
    const sourceDescriptions = card.sources
      .map((s, i) => `Source ${i + 1} (${s.label}): see attached content`)
      .join('\n')

    return [
      'You are helping write a study flashcard from highlighted source material.',
      `Current front: ${card.front || '(empty)'}`,
      `Current back: ${card.back || '(empty)'}`,
      card.sources.length > 0 ? `Sources:\n${sourceDescriptions}` : '',
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
