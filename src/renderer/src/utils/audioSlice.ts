import { TRANSCRIPTION_SAMPLE_RATE } from '../../../shared/audio'

/** Fetches and fully decodes a video's audio track — the whole file, not just a range, since
 *  decodeAudioData needs a complete container to parse. Costs real time for a long video, so callers
 *  should cache the result (see VideoPlayer's audioBufferRef) rather than re-decoding per transcribe. */
export async function decodeVideoAudio(url: string): Promise<AudioBuffer> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    ctx.close()
  }
}

/** Slices [startSeconds, endSeconds) out of an already-decoded track, downmixes to mono, and
 *  resamples to TRANSCRIPTION_SAMPLE_RATE via OfflineAudioContext — the exact format Whisper models
 *  expect, computed once here so neither transcription engine has to think about it. */
export async function sliceForTranscription(buffer: AudioBuffer, startSeconds: number, endSeconds: number): Promise<Float32Array> {
  const startSample = Math.max(0, Math.floor(startSeconds * buffer.sampleRate))
  const endSample = Math.min(buffer.length, Math.ceil(endSeconds * buffer.sampleRate))
  const sliceLength = Math.max(1, endSample - startSample)

  const sliceBuffer = new AudioBuffer({
    length: sliceLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate
  })
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    sliceBuffer.copyToChannel(buffer.getChannelData(channel).subarray(startSample, endSample), channel)
  }

  const renderedLength = Math.max(1, Math.ceil((sliceLength / buffer.sampleRate) * TRANSCRIPTION_SAMPLE_RATE))
  const offlineCtx = new OfflineAudioContext(1, renderedLength, TRANSCRIPTION_SAMPLE_RATE)
  const source = offlineCtx.createBufferSource()
  source.buffer = sliceBuffer
  source.connect(offlineCtx.destination)
  source.start()
  const rendered = await offlineCtx.startRendering()
  return rendered.getChannelData(0)
}
