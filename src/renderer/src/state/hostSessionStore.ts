import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { createLiveSession } from '../lib/liveSession/createSession'
import { computeSpeedRankedPoints, type TimedAnswer } from '../lib/liveSession/scoring'
import { computeLeaderboard, type LeaderboardEntry } from '../lib/liveSession/leaderboard'
import { QUESTION_SECONDS } from '../lib/liveSession/constants'
import type { ShareFormat } from '../../../shared/types'

export interface HostQuestion {
  id: string
  questionIndex: number
  frontSnapshot: string
  format: ShareFormat
  mcqOptions: string[] | null
}

export interface HostParticipant {
  userId: string
  displayName: string
}

export interface AnswerBreakdownRow {
  userId: string
  displayName: string
  isCorrect: boolean | null
  pointsAwarded: number | null
}

type HostPhase = 'lobby' | 'question' | 'revealed' | 'ended'

interface QuestionRow {
  id: string
  question_index: number
  front_snapshot: string
  format: ShareFormat
  mcq_options: string[] | null
}

interface AnswerRow {
  id: string
  user_id: string
  selected_mcq_index: number | null
  free_text_answer: string | null
  answered_at: string
}

interface AnswerKeyRow {
  correct_mcq_index: number | null
  free_text_rubric: string | null
}

interface ParticipantRow {
  user_id: string
  display_name: string
}

interface HostSessionState {
  sessionId: string | null
  joinCode: string | null
  folderName: string | null
  questions: HostQuestion[]
  currentQuestionIndex: number
  phase: HostPhase
  deadline: string | null
  participants: HostParticipant[]
  answeredCount: number
  revealedAnswers: AnswerBreakdownRow[]
  leaderboard: LeaderboardEntry[]

  createAndHost: (folderId: string, folderName: string) => Promise<void>
  startSession: () => Promise<void>
  refreshParticipants: () => Promise<void>
  refreshAnsweredCount: () => Promise<void>
  revealResults: () => Promise<void>
  nextQuestion: () => Promise<void>
  endSession: () => Promise<void>
  reset: () => void
}

function computeDeadline(): string {
  return new Date(Date.now() + QUESTION_SECONDS * 1000).toISOString()
}

export const useHostSessionStore = create<HostSessionState>((set, get) => ({
  sessionId: null,
  joinCode: null,
  folderName: null,
  questions: [],
  currentQuestionIndex: -1,
  phase: 'lobby',
  deadline: null,
  participants: [],
  answeredCount: 0,
  revealedAnswers: [],
  leaderboard: [],

  createAndHost: async (folderId, folderName) => {
    const { sessionId, joinCode } = await createLiveSession(folderId, folderName)
    const { data, error } = await supabase
      .from('live_session_questions')
      .select('id, question_index, front_snapshot, format, mcq_options')
      .eq('session_id', sessionId)
      .order('question_index', { ascending: true })
    if (error) throw error
    const questions = ((data ?? []) as QuestionRow[]).map((r) => ({
      id: r.id,
      questionIndex: r.question_index,
      frontSnapshot: r.front_snapshot,
      format: r.format,
      mcqOptions: r.mcq_options
    }))
    set({ sessionId, joinCode, folderName, questions, currentQuestionIndex: -1, phase: 'lobby' })
  },

  startSession: async () => {
    const { sessionId } = get()
    if (!sessionId) return
    const deadline = computeDeadline()
    const { error } = await supabase.from('live_sessions').update({ status: 'active', current_question_index: 0, started_at: new Date().toISOString() }).eq('id', sessionId)
    if (error) throw error
    set({ currentQuestionIndex: 0, phase: 'question', deadline, answeredCount: 0, revealedAnswers: [] })
  },

  refreshParticipants: async () => {
    const { sessionId } = get()
    if (!sessionId) return
    const { data, error } = await supabase.from('live_session_participants').select('user_id, display_name').eq('session_id', sessionId)
    if (error) throw error
    set({ participants: ((data ?? []) as ParticipantRow[]).map((r) => ({ userId: r.user_id, displayName: r.display_name })) })
  },

  refreshAnsweredCount: async () => {
    const { sessionId, questions, currentQuestionIndex } = get()
    const question = questions[currentQuestionIndex]
    if (!sessionId || !question) return
    const { count, error } = await supabase
      .from('live_session_answers')
      .select('id', { count: 'exact', head: true })
      .eq('question_id', question.id)
    if (error) throw error
    set({ answeredCount: count ?? 0 })
  },

  revealResults: async () => {
    const { sessionId, questions, currentQuestionIndex, participants } = get()
    const question = questions[currentQuestionIndex]
    if (!sessionId || !question) return

    const [{ data: answerRows, error: answersError }, { data: keyRow, error: keyError }] = await Promise.all([
      supabase
        .from('live_session_answers')
        .select('id, user_id, selected_mcq_index, free_text_answer, answered_at')
        .eq('question_id', question.id),
      supabase.from('live_session_answer_keys').select('correct_mcq_index, free_text_rubric').eq('question_id', question.id).single()
    ])
    if (answersError) throw answersError
    if (keyError) throw keyError

    const answers = (answerRows ?? []) as AnswerRow[]
    const key = keyRow as AnswerKeyRow

    let correctness: Map<string, boolean>
    if (question.format === 'mcq') {
      correctness = new Map(answers.map((a) => [a.id, a.selected_mcq_index === key.correct_mcq_index]))
    } else {
      const toJudge = answers.filter((a) => a.free_text_answer && a.free_text_answer.trim())
      const judgments =
        toJudge.length > 0 && key.free_text_rubric
          ? await window.api.ai.judgeFreeTextAnswers({
              rubric: key.free_text_rubric,
              answers: toJudge.map((a) => ({ answerId: a.id, text: a.free_text_answer! }))
            })
          : { judgments: [] }
      const byAnswerId = new Map(judgments.judgments.map((j) => [j.answerId, j.isCorrect]))
      correctness = new Map(answers.map((a) => [a.id, byAnswerId.get(a.id) ?? false]))
    }

    const correctAnswers: TimedAnswer[] = answers.filter((a) => correctness.get(a.id)).map((a) => ({ userId: a.user_id, answeredAt: a.answered_at }))
    const pointsByUser = computeSpeedRankedPoints(correctAnswers)

    const now = new Date().toISOString()
    await Promise.all(
      answers.map((a) => {
        const isCorrect = correctness.get(a.id) ?? false
        const points = isCorrect ? (pointsByUser.get(a.user_id) ?? 0) : 0
        return supabase.from('live_session_answers').update({ is_correct: isCorrect, points_awarded: points, judged_at: now }).eq('id', a.id)
      })
    )

    const displayNameByUser = new Map(participants.map((p) => [p.userId, p.displayName]))
    const revealedAnswers: AnswerBreakdownRow[] = answers.map((a) => ({
      userId: a.user_id,
      displayName: displayNameByUser.get(a.user_id) ?? 'Unknown',
      isCorrect: correctness.get(a.id) ?? false,
      pointsAwarded: (correctness.get(a.id) ? pointsByUser.get(a.user_id) : 0) ?? 0
    }))

    const leaderboard = await computeLeaderboard(sessionId)
    set({ phase: 'revealed', revealedAnswers, leaderboard })
  },

  nextQuestion: async () => {
    const { sessionId, currentQuestionIndex, questions } = get()
    const nextIndex = currentQuestionIndex + 1
    if (!sessionId || nextIndex >= questions.length) return
    const deadline = computeDeadline()
    const { error } = await supabase.from('live_sessions').update({ current_question_index: nextIndex }).eq('id', sessionId)
    if (error) throw error
    set({ currentQuestionIndex: nextIndex, phase: 'question', deadline, answeredCount: 0, revealedAnswers: [] })
  },

  endSession: async () => {
    const { sessionId } = get()
    if (!sessionId) return
    const { error } = await supabase.from('live_sessions').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', sessionId)
    if (error) throw error
    const leaderboard = await computeLeaderboard(sessionId)
    set({ phase: 'ended', leaderboard })
  },

  reset: () =>
    set({
      sessionId: null,
      joinCode: null,
      folderName: null,
      questions: [],
      currentQuestionIndex: -1,
      phase: 'lobby',
      deadline: null,
      participants: [],
      answeredCount: 0,
      revealedAnswers: [],
      leaderboard: []
    })
}))
