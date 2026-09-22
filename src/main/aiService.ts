import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import type {
  AiExtractPaperTemplateRequest,
  AiExtractPaperTemplateResult,
  AiGeneratePaperQuestionsRequest,
  AiGeneratePaperQuestionsResult,
  AiGeneratedQuestion,
  AiJudgeFreeTextRequest,
  AiJudgeFreeTextResult,
  AiMarkedAnswer,
  AiMarkPaperAnswersRequest,
  AiMarkPaperAnswersResult,
  AiRegenerateRequest,
  AiRegenerateResult,
  AiSharePrepRequest,
  AiSharePrepResult,
  AiSummarizeResult,
  GenerationComplexity,
  PaperQuestionFormat,
  PaperSection,
  PaperTemplateStructure,
  ShareFormat
} from '../shared/types'
import { Repository } from './db/repository'
import { imageMediaType } from './imageUtils'
import { createAnthropicClient, featureHeader } from './anthropicClient'

const MODEL = 'claude-sonnet-5'

/** A past paper's extracted text is capped per-file before it ever reaches the prompt — plenty for
 *  a normal multi-page exam paper's worth of structure, and keeps a mis-clicked huge PDF from
 *  ballooning the request. */
const MAX_PAPER_CHARS = 20_000

function isPaperQuestionFormat(value: unknown): value is PaperQuestionFormat {
  return value === 'short_answer' || value === 'long_answer' || value === 'mcq' || value === 'essay'
}

type ContentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam

export class AiService {
  private client: Anthropic = createAnthropicClient()

  constructor(private repo: Repository) {}

  async regenerate(req: AiRegenerateRequest): Promise<AiRegenerateResult> {
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
    }, featureHeader('regenerate'))

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

    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: this.buildSharePrepPrompt(req) }]
    }, featureHeader('share_prep'))

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
      '- A rewritten version of the CORRECT answer, for display as the right multiple-choice option instead of the raw Back text: same meaning, but reworded so it reads in the same voice, length and formatting as the distractors — someone should not be able to spot the right answer just because it looks or sounds different from the wrong ones (odd capitalization, a stray trailing period, being noticeably longer/shorter, copied-from-a-slide phrasing, etc.). Do not soften, hedge, or change the actual meaning.',
      '- A short free-text judging rubric: 1-2 sentences describing what a correct answer must contain, for another AI pass to grade a typed response against later.',
      '',
      'Respond with ONLY a single JSON object, no markdown code fences, no commentary before or after:',
      '{"format": "mcq" | "free_text", "distractors": ["...", "...", "..."], "correctRewrite": "...", "rubric": "..."}'
    ].join('\n')
  }

  /** Same fence-stripping/parse/shape-check convention as parseSharePrepResponse/parseJudgeResponse
   *  below, factored out here since the exam paper generator has two call sites for it. */
  private parseJsonBlock(text: string, label: string): unknown {
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
      return parsed
    } catch {
      throw new Error(`Could not parse ${label} as JSON: ${text}`)
    }
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
    const { format, distractors, correctRewrite, rubric } = parsed as Record<string, unknown>
    if (format !== 'mcq' && format !== 'free_text') {
      throw new Error(`AI share-prep response had an invalid format: ${text}`)
    }
    if (!Array.isArray(distractors) || distractors.length !== 3 || distractors.some((d) => typeof d !== 'string' || !d.trim())) {
      throw new Error(`AI share-prep response did not have exactly 3 non-empty distractors: ${text}`)
    }
    if (typeof correctRewrite !== 'string' || !correctRewrite.trim()) {
      throw new Error(`AI share-prep response had an empty correctRewrite: ${text}`)
    }
    if (typeof rubric !== 'string' || !rubric.trim()) {
      throw new Error(`AI share-prep response had an empty rubric: ${text}`)
    }
    return {
      recommendedFormat: format as ShareFormat,
      mcqDistractors: distractors as string[],
      mcqCorrectRewrite: correctRewrite.trim(),
      freeTextRubric: rubric.trim()
    }
  }

  /** Batched free-text grading for one live-session question — every submitted answer judged
   *  against the same cached rubric in a single call, not one call per answer (this is exactly the
   *  "second structured-output call type" prepareForSharing's own docblock flagged as worth
   *  reconsidering tool-use for — sticking with the same JSON-in-text-block convention anyway,
   *  since switching now would fragment the codebase over one call site for no real benefit). Runs
   *  only on the host's machine (live sessions can't exist without a connected host), never called
   *  from a guest's client. */
  async judgeFreeTextAnswers(req: AiJudgeFreeTextRequest): Promise<AiJudgeFreeTextResult> {
    if (req.answers.length === 0) return { judgments: [] }

    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1536,
      messages: [{ role: 'user', content: this.buildJudgePrompt(req) }]
    }, featureHeader('judge_free_text'))

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

  /** Whole-document summary — a separate call from regenerate() (one card's front/back), over
   *  every parsed text element on every page, in reading order. "Pure compute, caller persists"
   *  like every other AI call here: registerIpc.ts saves the result via repo.updateDocumentSummary
   *  after this resolves, not this method itself. Text-only (unlike regenerate/OCR, which attach
   *  images) — a whole deck's worth of slide images would be an expensive, mostly-redundant
   *  attachment when the parsed text already carries the content; image-only slides (a photo with
   *  no OCR'd text) just contribute nothing to the summary, same as they'd contribute nothing to a
   *  human skimming the deck's outline. */
  async summarizeDocument(documentId: string): Promise<AiSummarizeResult> {

    const pages = this.repo.getPages(documentId)
    const text = pages
      .map((page) => {
        const elementText = this.repo
          .getElements(page.id)
          .map((el) => el.text)
          .filter((t): t is string => !!t && t.trim().length > 0)
          .join('\n')
        return elementText ? `--- Page ${page.pageIndex + 1} ---\n${elementText}` : null
      })
      .filter((t): t is string => !!t)
      .join('\n\n')

    if (!text.trim()) throw new Error('This document has no extracted text to summarize (image-only slides aren\'t OCR\'d here).')

    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: this.buildSummarizePrompt(text) }]
    }, featureHeader('summarize'))

    const summary = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    if (!summary) throw new Error('AI returned an empty summary')
    return { summary }
  }

  private buildSummarizePrompt(text: string): string {
    return [
      'You are summarizing an entire imported study document (a slide deck or PDF) for a student.',
      'Write a concise summary of the whole document\'s content — the main topics covered and how',
      'they relate, not a page-by-page recap. Aim for 3-6 short paragraphs or a tight bulleted',
      'outline, whichever fits the material better. No preamble like "This document covers..." —',
      'start directly with the content.',
      '',
      'Document content (page markers included for your own orientation, don\'t reproduce them):',
      text
    ].join('\n')
  }

  /** Exam paper generator, step 1: infer a past paper's STRUCTURE (sections, formats, question
   *  counts, marks) and STYLE (how each section's questions are actually phrased — command words,
   *  sentence structure, scenario stems, level of detail) from its extracted text — never its
   *  actual question content, which is discarded once this returns (see PaperTemplateStructure's
   *  own doc comment). Several papers at once (a past-paper series) let the AI spot what's
   *  consistent across them rather than fitting one paper's quirks too tightly. */
  async extractPaperTemplate(req: AiExtractPaperTemplateRequest): Promise<AiExtractPaperTemplateResult> {
    const message = await this.client.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: this.buildExtractTemplatePrompt(req) }]
      },
      featureHeader('paper_template')
    )
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    return { structure: this.parseTemplateResponse(text) }
  }

  private buildExtractTemplatePrompt(req: AiExtractPaperTemplateRequest): string {
    const papersText = req.papers
      .map((p) => `=== ${p.filename} ===\n${p.text.slice(0, MAX_PAPER_CHARS)}`)
      .join('\n\n')
    return [
      'You are analyzing one or more past exam papers to infer their STRUCTURE and STYLE, for',
      'generating fresh papers with the same shape and feel later. Do NOT reproduce, paraphrase, or',
      'reference any of the actual question content, names, dates, or specific facts from these',
      'papers anywhere in your response.',
      '',
      'STRUCTURE means: how the paper is organized into sections, what format each section uses, how',
      'many questions, and how marks are allocated.',
      '',
      'STYLE means: for each section, describe HOW its questions are typically asked — the command',
      'words used ("Explain", "Compare", "Which of the following…", "Describe", "Calculate"), typical',
      'question length and sentence structure, whether questions open with a scenario/stem before the',
      'actual ask, and the level of detail or specificity expected in a full-marks answer. Describe',
      'this as a general pattern in your own words — never quote or closely paraphrase an actual',
      'question from the source.',
      '',
      'If multiple papers are given and they differ, use the pattern most consistent across them.',
      '',
      'Formats:',
      '- "mcq" — multiple choice, one correct option among several.',
      '- "short_answer" — a brief factual answer, a sentence or two.',
      '- "long_answer" — a fuller written answer, a paragraph or structured response.',
      '- "essay" — an extended written response.',
      '',
      'Respond with ONLY a single JSON object, no markdown code fences, no commentary before or after:',
      '{"paperTitle": "...", "totalMarks": 100 | null, "sections": [{"name": "...", "instructions": "...", "questionCount": 10, "format": "mcq" | "short_answer" | "long_answer" | "essay", "marksPerQuestion": 1 | null, "questionStyle": "..."}]}',
      '',
      'Past paper(s):',
      papersText
    ].join('\n')
  }

  private parseTemplateResponse(text: string): PaperTemplateStructure {
    const parsed = this.parseJsonBlock(text, 'AI paper-template response')
    const { paperTitle, totalMarks, sections } = parsed as Record<string, unknown>
    if (typeof paperTitle !== 'string' || !paperTitle.trim()) {
      throw new Error(`AI paper-template response had an empty paperTitle: ${text}`)
    }
    if (totalMarks !== null && typeof totalMarks !== 'number') {
      throw new Error(`AI paper-template response had an invalid totalMarks: ${text}`)
    }
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error(`AI paper-template response had no sections: ${text}`)
    }
    const parsedSections: PaperSection[] = sections.map((s, i) => {
      if (typeof s !== 'object' || s === null) throw new Error(`AI paper-template response section ${i} was not an object: ${text}`)
      const { name, instructions, questionCount, format, marksPerQuestion, questionStyle } = s as Record<string, unknown>
      if (typeof name !== 'string' || !name.trim()) throw new Error(`AI paper-template response section ${i} had an empty name: ${text}`)
      if (typeof instructions !== 'string') throw new Error(`AI paper-template response section ${i} had invalid instructions: ${text}`)
      if (typeof questionCount !== 'number' || questionCount < 1) {
        throw new Error(`AI paper-template response section ${i} had an invalid questionCount: ${text}`)
      }
      if (!isPaperQuestionFormat(format)) throw new Error(`AI paper-template response section ${i} had an invalid format: ${text}`)
      if (marksPerQuestion !== null && typeof marksPerQuestion !== 'number') {
        throw new Error(`AI paper-template response section ${i} had an invalid marksPerQuestion: ${text}`)
      }
      if (typeof questionStyle !== 'string' || !questionStyle.trim()) {
        throw new Error(`AI paper-template response section ${i} had an empty questionStyle: ${text}`)
      }
      return {
        name: name.trim(),
        instructions: instructions.trim(),
        questionCount: Math.round(questionCount),
        format,
        marksPerQuestion,
        questionStyle: questionStyle.trim()
      }
    })
    return { paperTitle: paperTitle.trim(), totalMarks, sections: parsedSections }
  }

  /** Exam paper generator, step 2: write fresh questions to fit a template's structure, grounded in
   *  the given flashcards. One call for the whole paper (every section at once) rather than one per
   *  section — cheaper, and lets the AI avoid repeating the same card across sections on its own. */
  async generatePaperQuestions(req: AiGeneratePaperQuestionsRequest): Promise<AiGeneratePaperQuestionsResult> {
    const message = await this.client.messages.create(
      {
        model: MODEL,
        // A whole paper's worth of questions (style guide + every section + a modelAnswer each) can
        // run well past 8192 output tokens for a paper with many sections/questions — that used to
        // get silently cut off mid-JSON and fail with an opaque parse error. 16000 gives real
        // headroom; the stop_reason check below still catches it cleanly if a paper is big enough
        // to blow through even that, instead of a confusing "Could not parse ... as JSON" error.
        max_tokens: 16000,
        messages: [{ role: 'user', content: this.buildGenerateQuestionsPrompt(req) }]
      },
      featureHeader('paper_generate')
    )
    if (message.stop_reason === 'max_tokens') {
      throw new Error(
        'The generated paper was too long to finish in one response — try generating from fewer folders/cards, or a template with fewer questions.'
      )
    }
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    return { questions: this.parseGeneratedQuestions(text, req) }
  }

  private buildGenerateQuestionsPrompt(req: AiGeneratePaperQuestionsRequest): string {
    const sectionsText = req.structure.sections
      .map(
        (s, i) =>
          `${i}. "${s.name}" — ${s.questionCount} question(s), format "${s.format}"${
            s.marksPerQuestion !== null ? `, ${s.marksPerQuestion} mark(s) each` : ''
          }. Instructions: ${s.instructions || '(none given)'}. Question style to match: ${s.questionStyle}`
      )
      .join('\n')
    const cardsText = req.cards.map((c) => `[${c.ref}] Front: ${c.front}\n    Back: ${c.back}`).join('\n')
    return [
      `You are writing a fresh "${req.structure.paperTitle}"-style exam paper. Below is the required`,
      'structure (already fixed — follow it exactly, one entry per section index) and a numbered list',
      'of flashcards to draw material from. Every question you write must be grounded in one or more',
      'of these flashcards — do not invent facts that aren\'t in them.',
      '',
      'Structure (sectionIndex: description):',
      sectionsText,
      '',
      'Flashcards (reference by their [N] number):',
      cardsText,
      '',
      'For each question:',
      "- Phrase it to match its section's given question style above — same command words, sentence",
      "  structure, and level of detail. Don't fall back to generic phrasing that ignores it.",
      '- "mcq": include exactly 4 "mcqOptions" (the correct one plus 3 plausible wrong ones, none a',
      '  paraphrase of it) and "mcqCorrectIndex" (0-based index of the correct option within mcqOptions).',
      '  Do not make the correct option identifiable just by how it reads (length, phrasing, tone) —',
      '  write all 4 in the same style.',
      '- "short_answer"/"long_answer"/"essay": mcqOptions and mcqCorrectIndex must be null.',
      '- Every question needs a "modelAnswer": for mcq, a one-line explanation of why the correct',
      '  option is right; otherwise, what a full-marks answer must contain.',
      '- "cardRefs": the [N] number(s) (as a JSON array of integers) of every flashcard this specific',
      '  question actually drew from — usually just one, occasionally more for a synthesis question.',
      '- "marks": a sensible integer, using the section\'s marksPerQuestion if it gave one.',
      '',
      'Respond with ONLY a single JSON object, no markdown code fences, no commentary before or after:',
      '{"questions": [{"sectionIndex": 0, "format": "mcq", "prompt": "...", "marks": 1, "mcqOptions": ["...","...","...","..."] | null, "mcqCorrectIndex": 0 | null, "modelAnswer": "...", "cardRefs": [1, 4]}]}'
    ].join('\n')
  }

  private parseGeneratedQuestions(text: string, req: AiGeneratePaperQuestionsRequest): AiGeneratedQuestion[] {
    const parsed = this.parseJsonBlock(text, 'AI paper-generation response')
    const { questions } = parsed as Record<string, unknown>
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error(`AI paper-generation response had no questions: ${text}`)
    }
    const validRefs = new Set(req.cards.map((c) => c.ref))
    const sectionCount = req.structure.sections.length
    return questions.map((q, i): AiGeneratedQuestion => {
      if (typeof q !== 'object' || q === null) throw new Error(`AI paper-generation response question ${i} was not an object: ${text}`)
      const { sectionIndex, format, prompt, marks, mcqOptions, mcqCorrectIndex, modelAnswer, cardRefs } = q as Record<string, unknown>
      if (typeof sectionIndex !== 'number' || sectionIndex < 0 || sectionIndex >= sectionCount) {
        throw new Error(`AI paper-generation response question ${i} had an invalid sectionIndex: ${text}`)
      }
      if (!isPaperQuestionFormat(format)) throw new Error(`AI paper-generation response question ${i} had an invalid format: ${text}`)
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new Error(`AI paper-generation response question ${i} had an empty prompt: ${text}`)
      }
      if (marks !== null && marks !== undefined && typeof marks !== 'number') {
        throw new Error(`AI paper-generation response question ${i} had an invalid marks: ${text}`)
      }
      let options: string[] | null = null
      let correctIndex: number | null = null
      if (format === 'mcq') {
        if (!Array.isArray(mcqOptions) || mcqOptions.length < 2 || mcqOptions.some((o) => typeof o !== 'string' || !o.trim())) {
          throw new Error(`AI paper-generation response question ${i} had invalid mcqOptions: ${text}`)
        }
        if (typeof mcqCorrectIndex !== 'number' || mcqCorrectIndex < 0 || mcqCorrectIndex >= mcqOptions.length) {
          throw new Error(`AI paper-generation response question ${i} had an invalid mcqCorrectIndex: ${text}`)
        }
        options = mcqOptions as string[]
        correctIndex = mcqCorrectIndex
      }
      if (typeof modelAnswer !== 'string' || !modelAnswer.trim()) {
        throw new Error(`AI paper-generation response question ${i} had an empty modelAnswer: ${text}`)
      }
      // Refs the AI hallucinated (not in the list we gave it) are dropped rather than failing the
      // whole question — a question with zero surviving refs still keeps its content, it just won't
      // show a backlink (same graceful-degradation choice as repository.ts's createGeneratedPaper
      // dropping a ref to a since-deleted card).
      const refs = Array.isArray(cardRefs) ? cardRefs.filter((r): r is number => typeof r === 'number' && validRefs.has(r)) : []
      return {
        sectionIndex,
        format,
        prompt: prompt.trim(),
        marks: typeof marks === 'number' ? Math.round(marks) : null,
        mcqOptions: options,
        mcqCorrectIndex: correctIndex,
        modelAnswer: modelAnswer.trim(),
        cardRefs: refs
      }
    })
  }

  /** Marking a taken paper's free-text answers (short_answer/long_answer/essay) — mcq is graded
   *  locally by index comparison and never reaches here. One call for every free-text answer in the
   *  submission, same batching reasoning as generatePaperQuestions. Small `ref` integers again (not
   *  the questions' real ids) — same reasoning as cardRefs elsewhere. Unlike parseGeneratedQuestions
   *  (which can drop a bad cardRef and keep the question), a missing/invalid marking for a submitted
   *  answer can't just be dropped — the caller needs a mark for every answer it sent — so any ref the
   *  AI didn't return cleanly falls back to 0 marks with a generic note rather than throwing and
   *  losing every other answer's real marking. */
  async markPaperAnswers(req: AiMarkPaperAnswersRequest): Promise<AiMarkPaperAnswersResult> {
    if (req.items.length === 0) return { marked: [] }

    const message = await this.client.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: this.buildMarkPrompt(req) }]
      },
      featureHeader('paper_mark')
    )
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    return { marked: this.parseMarkedAnswers(text, req) }
  }

  private buildMarkPrompt(req: AiMarkPaperAnswersRequest): string {
    const itemsText = req.items
      .map(
        (item) =>
          `[${item.ref}] (${item.format}, worth ${item.marks} mark(s))\nQuestion: ${item.prompt}\nModel answer / marking guidance: ${item.modelAnswer}\nStudent's answer: ${item.studentAnswer || '(left blank)'}`
      )
      .join('\n\n')
    return [
      'You are marking a student\'s answers to exam questions. For each item below, compare the',
      "student's answer against the model answer / marking guidance and award a whole number of",
      "marks from 0 up to that item's max. Be reasonably generous about phrasing, but strict about",
      'missing or incorrect substance — an answer covering half the required points should get',
      'roughly half the marks, not full marks for effort. A blank answer gets 0.',
      '',
      'Items to mark:',
      itemsText,
      '',
      'For each item, also write one short sentence of feedback (what was right/missing).',
      '',
      'Respond with ONLY a single JSON object, no markdown code fences, no commentary before or after,',
      'with exactly one entry per item above, in any order:',
      '{"marked": [{"ref": 1, "marksAwarded": 2, "feedback": "..."}]}'
    ].join('\n')
  }

  private parseMarkedAnswers(text: string, req: AiMarkPaperAnswersRequest): AiMarkedAnswer[] {
    const itemsByRef = new Map(req.items.map((item) => [item.ref, item]))
    const byRef = new Map<number, AiMarkedAnswer>()
    try {
      const parsed = this.parseJsonBlock(text, 'AI paper-marking response')
      const { marked } = parsed as Record<string, unknown>
      if (Array.isArray(marked)) {
        for (const m of marked) {
          if (typeof m !== 'object' || m === null) continue
          const { ref, marksAwarded, feedback } = m as Record<string, unknown>
          const item = typeof ref === 'number' ? itemsByRef.get(ref) : undefined
          if (!item || typeof marksAwarded !== 'number' || typeof feedback !== 'string' || !feedback.trim()) continue
          byRef.set(ref as number, { ref: ref as number, marksAwarded: Math.max(0, Math.min(item.marks, Math.round(marksAwarded))), feedback: feedback.trim() })
        }
      }
    } catch {
      // Fall through — every item still gets a result via the fallback below, just with 0 marks
      // and a note, rather than losing the whole submission's marking to one malformed response.
    }
    // Anything the AI didn't return a valid marking for (missing ref, malformed entry, or the
    // whole response failed to parse) still needs a result — the caller submitted every one of
    // these and expects a mark for each.
    return req.items.map(
      (item) => byRef.get(item.ref) ?? { ref: item.ref, marksAwarded: 0, feedback: 'Could not be marked automatically — review it yourself against the model answer.' }
    )
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
