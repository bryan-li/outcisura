import { create } from 'zustand'

export type PomodoroMode = 'work' | 'break'

const WORK_MINUTES = 25
const BREAK_MINUTES = 5

interface PomodoroState {
  mode: PomodoroMode
  secondsRemaining: number
  running: boolean
  start: () => void
  pause: () => void
  /** Resets the current mode's countdown back to its full duration and stops — doesn't switch
   *  mode, matching a plain "start this phase over" expectation rather than skipping to the other. */
  reset: () => void
  /** Called once a second by PomodoroTimer's own interval (this store doesn't run a timer itself,
   *  same "component owns the interval, store just holds state" split as the live-session
   *  countdowns in HostControlView/LiveSessionPlayer). Switches mode and keeps running when a
   *  countdown reaches zero, so work flows straight into break without a second click. */
  tick: () => void
}

function durationFor(mode: PomodoroMode): number {
  return (mode === 'work' ? WORK_MINUTES : BREAK_MINUTES) * 60
}

export const usePomodoroStore = create<PomodoroState>((set, get) => ({
  mode: 'work',
  secondsRemaining: durationFor('work'),
  running: false,

  start: () => set({ running: true }),
  pause: () => set({ running: false }),
  reset: () => set({ running: false, secondsRemaining: durationFor(get().mode) }),

  tick: () => {
    const { secondsRemaining, mode, running } = get()
    if (!running) return
    if (secondsRemaining <= 1) {
      const nextMode: PomodoroMode = mode === 'work' ? 'break' : 'work'
      set({ mode: nextMode, secondsRemaining: durationFor(nextMode) })
    } else {
      set({ secondsRemaining: secondsRemaining - 1 })
    }
  }
}))
