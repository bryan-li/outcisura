import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { extname } from 'path'
import type { AiRegenerateRequest, AiRegenerateResult, CardRecord } from '../shared/types'
import { Repository } from './db/repository'

const MODEL = 'claude-sonnet-5'

type ContentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function imageMediaType(path: string): ImageMediaType {
  const ext = extname(path).slice(1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

export class AiService {
  private client: Anthropic

  constructor(apiKey: string, private repo: Repository) {
    this.client = new Anthropic({ apiKey })
  }

  async regenerate(req: AiRegenerateRequest): Promise<AiRegenerateResult> {
    const card = this.repo.getCard(req.cardId)
    if (!card) throw new Error(`Card ${req.cardId} not found`)

    const content: ContentBlock[] = [{ type: 'text', text: this.buildPrompt(card, req.instruction) }]

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

    return this.parseResponse(text)
  }

  private buildPrompt(card: CardRecord, instruction?: string): string {
    const sourceDescriptions = card.sources
      .map((s, i) => `Source ${i + 1} (${s.label}): see attached content`)
      .join('\n')

    return [
      'You are helping write a study flashcard from highlighted source material.',
      `Current front: ${card.front || '(empty)'}`,
      `Current back: ${card.back || '(empty)'}`,
      card.sources.length > 0 ? `Sources:\n${sourceDescriptions}` : '',
      instruction ? `User instruction: ${instruction}` : '',
      '',
      'Rewrite this as a single clear, focused flashcard.',
      'If the answer is naturally a set of discrete items (causes, symptoms, steps, criteria, etc.), phrase the front as a question ending with the count in parentheses — e.g. "What are the causes of X? (3)" — and write the back as exactly that many bullet points, one per line, each starting with "• ". Otherwise (a single fact or definition), keep the back as plain prose — don\'t force a list where there isn\'t one.',
      'Respond in exactly this format, no extra commentary:',
      'FRONT: <question>',
      'BACK: <answer, one or more lines>'
    ]
      .filter(Boolean)
      .join('\n')
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

  private parseResponse(text: string): AiRegenerateResult {
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
