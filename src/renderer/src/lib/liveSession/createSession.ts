import { supabase } from '../supabase'
import { getCardSharePreviews } from './sharePreview'

export interface CreateSessionResult {
  sessionId: string
  joinCode: string
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/I/0/1 — unambiguous when read aloud
const CODE_LENGTH = 6
const MAX_CODE_ATTEMPTS = 5

function randomJoinCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

interface QuestionRow {
  id: string
  question_index: number
}

/** Creates a live session from a folder's already-prepped cards: the `live_sessions` row, then a
 *  shuffled-MCQ-options question row and a host-only answer-key row per ready card. Each bulk
 *  insert is one atomic multi-row Postgres statement; if either step after the session row fails,
 *  the session row is deleted (no client-side cross-table transaction over REST) so a host never
 *  lands in a lobby for a session with zero or partial questions. */
export async function createLiveSession(folderId: string, folderName: string): Promise<CreateSessionResult> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  let sessionId: string | null = null
  let joinCode: string | null = null
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomJoinCode()
    const { data, error } = await supabase
      .from('live_sessions')
      .insert({ join_code: code, folder_id: folderId, folder_name_snapshot: folderName, status: 'lobby' })
      .select('id')
      .single()
    if (!error) {
      sessionId = (data as { id: string }).id
      joinCode = code
      break
    }
    if (error.code !== '23505') throw error // not a join-code collision — a real failure
  }
  if (!sessionId || !joinCode) throw new Error('Could not generate a unique join code — try again')

  try {
    const previews = (await getCardSharePreviews(folderId)).filter((c) => c.isPrepped)
    if (previews.length === 0) throw new Error('This folder has no prepared cards to host')

    const questionInputs = previews.map((card, index) => {
      const isMcq = card.recommendedFormat === 'mcq'
      let mcqOptions: string[] | null = null
      let correctMcqIndex: number | null = null
      if (isMcq) {
        const options = shuffle([card.back, ...(card.mcqDistractors ?? [])])
        mcqOptions = options
        correctMcqIndex = options.indexOf(card.back)
      }
      return {
        cardId: card.cardId,
        row: {
          session_id: sessionId,
          card_id: card.cardId,
          question_index: index,
          front_snapshot: card.front,
          format: card.recommendedFormat,
          mcq_options: mcqOptions
        },
        back: card.back,
        correctMcqIndex,
        rubric: card.freeTextRubric
      }
    })

    const { data: questionRows, error: questionsError } = await supabase
      .from('live_session_questions')
      .insert(questionInputs.map((q) => q.row))
      .select('id, question_index')
    if (questionsError) throw questionsError

    const byIndex = new Map<number, string>(((questionRows ?? []) as QuestionRow[]).map((r) => [r.question_index, r.id]))
    const answerKeyRows = questionInputs.map((q) => ({
      question_id: byIndex.get(q.row.question_index),
      session_id: sessionId,
      back_snapshot: q.back,
      correct_mcq_index: q.correctMcqIndex,
      free_text_rubric: q.rubric
    }))

    const { error: keysError } = await supabase.from('live_session_answer_keys').insert(answerKeyRows)
    if (keysError) throw keysError

    return { sessionId, joinCode }
  } catch (err) {
    await supabase.from('live_sessions').delete().eq('id', sessionId)
    throw err
  }
}
