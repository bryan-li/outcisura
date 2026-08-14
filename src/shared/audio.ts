/** Sample rate Whisper models expect — used on both sides of the transcription IPC boundary: the
 *  renderer resamples to this before sending audio over, and the main process's TranscriptionService
 *  assumes every buffer it receives is already at this rate. */
export const TRANSCRIPTION_SAMPLE_RATE = 16000
