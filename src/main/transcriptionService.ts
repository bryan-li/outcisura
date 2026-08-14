import type { TranscriptionEngine } from '../shared/types'
import { TRANSCRIPTION_SAMPLE_RATE } from '../shared/audio'

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

/** Generic transcription, behind one entry point regardless of engine — mirrors OcrService's split
 *  between a zero-setup local engine (Whisper-tiny via @xenova/transformers, no key needed) and an
 *  opt-in cloud engine (OpenAI's hosted Whisper API) that throws its own clear error with no key set. */
export class TranscriptionService {
  constructor(private openaiApiKey: string | null) {}

  /** Called when the user sets/changes/clears the key from Settings — takes effect immediately, no
   *  restart needed, mirroring AiService/OcrService's own setApiKey. */
  setApiKey(apiKey: string | null): void {
    this.openaiApiKey = apiKey
  }

  async transcribe(audioData: Float32Array, engine: TranscriptionEngine): Promise<string> {
    if (engine === 'whisper-local') return this.transcribeLocal(audioData)
    return this.transcribeOpenAi(audioData)
  }

  private async transcribeLocal(audioData: Float32Array): Promise<string> {
    const transcriber = await getLocalPipeline()
    const output = await transcriber(audioData)
    return output.text.trim()
  }

  private async transcribeOpenAi(audioData: Float32Array): Promise<string> {
    if (!this.openaiApiKey) throw new Error('OpenAI Whisper unavailable: set an OpenAI API key in Settings')

    const wavBuffer = encodeWav(audioData, TRANSCRIPTION_SAMPLE_RATE)
    // Buffer's .buffer is typed ArrayBufferLike (could in theory be a SharedArrayBuffer), which
    // doesn't structurally satisfy BlobPart — slice out a real ArrayBuffer, same defensive copy
    // already used for convertPptxToPdf's return.
    const wavArrayBuffer = wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength) as ArrayBuffer
    const form = new FormData()
    form.append('file', new Blob([wavArrayBuffer], { type: 'audio/wav' }), 'audio.wav')
    form.append('model', 'whisper-1')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.openaiApiKey}` },
      body: form
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText)
      throw new Error(`OpenAI transcription failed: ${errText}`)
    }
    const data = (await response.json()) as { text?: string }
    return (data.text ?? '').trim()
  }
}

/** Hand-rolled 16-bit PCM WAV encoder — OpenAI's API needs an actual audio file upload (unlike the
 *  local pipeline, which takes the Float32Array directly), and this is a small enough, single-purpose
 *  format that a dependency for it isn't worth adding. */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate (mono, 16-bit)
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  let offset = 44
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    buffer.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), offset)
    offset += 2
  }
  return buffer
}
