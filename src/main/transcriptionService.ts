import type { TranscriptionEngine } from '../shared/types'

type Transcriber = (audio: Float32Array) => Promise<{ text: string }>
let localPipelinePromise: Promise<Transcriber> | null = null

/** Loaded once and reused across calls — even cached-on-disk, re-instantiating the pipeline costs
 *  several hundred ms (per the standalone timing check this was verified with), not worth paying on
 *  every transcription. @xenova/transformers is ESM-only, so this is a dynamic import even though
 *  the rest of the main process is CJS — mirrors how OcrService lazy-loads tesseract.js's worker. */
async function getLocalPipeline(): Promise<Transcriber> {
  if (!localPipelinePromise) {
    localPipelinePromise = import('@xenova/transformers').then(
      ({ pipeline }) => pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en') as unknown as Promise<Transcriber>
    )
  }
  return localPipelinePromise
}

/** Transcription behind one entry point. Today the only engine is the local one (Whisper-tiny via
 *  @xenova/transformers — free, on-device, no account needed); the engine parameter stays so a hosted
 *  engine metered in credits can slot in later without changing callers. */
export class TranscriptionService {
  async transcribe(audioData: Float32Array, engine: TranscriptionEngine): Promise<string> {
    if (engine !== 'whisper-local') throw new Error(`Unsupported transcription engine: ${engine}`)
    const transcriber = await getLocalPipeline()
    const output = await transcriber(audioData)
    return output.text.trim()
  }
}
