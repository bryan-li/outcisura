import { create } from 'zustand'

interface OnboardingState {
  open: boolean
  start: () => void
  close: () => void
}

/** Whether the intro tour is on screen. Kept separate from uiStore's `view` because the tour is an
 *  overlay above whatever page you're on, not a page of its own. */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: false,
  start: () => set({ open: true }),
  close: () => set({ open: false })
}))

const seenKey = (userId: string): string => `outcisura.intro-seen.${userId}`

/** Per-user (not per-device) key so a second account on the same machine still gets its own tour.
 *  localStorage can throw or come back empty in odd environments — failing "not seen" means the
 *  worst case is one extra tour, never a broken app. */
export function hasSeenIntro(userId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(userId)) === '1'
  } catch {
    return false
  }
}

export function markIntroSeen(userId: string): void {
  try {
    window.localStorage.setItem(seenKey(userId), '1')
  } catch {
    /* non-fatal, see hasSeenIntro */
  }
}

/** Only accounts created in the last day get the automatic tour — otherwise everyone who already
 *  uses the app would get it on their next launch after this ships. The Settings debug button
 *  replays it for anyone. */
export function isFreshAccount(createdAt: string | undefined): boolean {
  if (!createdAt) return false
  const age = Date.now() - new Date(createdAt).getTime()
  return age >= 0 && age < 24 * 60 * 60 * 1000
}
