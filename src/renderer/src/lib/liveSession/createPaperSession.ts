import { supabase } from '../supabase'
import type { GeneratedPaperRecord } from '../../../../shared/types'

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

/** Hosts a generated exam paper as a live session — the same live_sessions/live_session_questions/
 *  live_session_answer_keys tables and the same mcq-by-index / AI-judged-free-text scoring as a
 *  regular card deck (createSession.ts), just built straight from the paper's already-generated
 *  questions rather than going through the card "prepare for hosting" AI step: a generated question
 *  already carries full mcqOptions/mcqCorrectIndex, or a modelAnswer that works directly as the
 *  free-text rubric — there's nothing left to prep, a generated paper is always host-ready.
 *
 *  live_sessions.folder_id stays null (it's nullable, and RLS never touches it — see the table's
 *  policies) — a hosted paper isn't tied to any local folder. folder_name_snapshot just borrows
 *  that column to show the paper's name in the lobby, same as a real deck's name would.
 *  live_session_questions.format only ever distinguishes 'mcq' | 'free_text', so every non-mcq
 *  paper format (short_answer/long_answer/essay) collapses to 'free_text' for hosting — the live
 *  quiz doesn't need the distinction a solo attempt does (see PaperAttemptSession.tsx). */
export async function createLiveSessionFromPaper(paper: GeneratedPaperRecord): Promise<CreateSessionResult> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  if (paper.questions.length === 0) throw new Error('This paper has no questions to host')

  let sessionId: string | null = null
  let joinCode: string | null = null
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomJoinCode()
    const { data, error } = await supabase
      .from('live_sessions')
      .insert({ join_code: code, folder_id: null, folder_name_snapshot: paper.name, status: 'lobby' })
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
    const ordered = [...paper.questions].sort((a, b) => a.sectionIndex - b.sectionIndex || a.questionIndex - b.questionIndex)

    const questionInputs = ordered.map((q, index) => {
      const isMcq = q.format === 'mcq' && !!q.mcqOptions && q.mcqOptions.length > 0
      let mcqOptions: string[] | null = null
      let correctMcqIndex: number | null = null
      if (isMcq) {
        const correctOption = q.mcqOptions![q.mcqCorrectIndex ?? 0]
        const options = shuffle(q.mcqOptions!)
        mcqOptions = options
        correctMcqIndex = options.indexOf(correctOption)
      }
      return {
        row: {
          session_id: sessionId,
          card_id: null,
          question_index: index,
          front_snapshot: q.prompt,
          format: isMcq ? 'mcq' : 'free_text',
          mcq_options: mcqOptions
        },
        back: q.modelAnswer,
        correctMcqIndex,
        rubric: isMcq ? null : q.modelAnswer
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
