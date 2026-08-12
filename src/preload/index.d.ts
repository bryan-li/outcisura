import type { FlashcardApi } from '../shared/ipc'

declare global {
  interface Window {
    api: FlashcardApi
  }
}
