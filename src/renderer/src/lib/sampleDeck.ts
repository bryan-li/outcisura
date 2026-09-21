import sampleDeckUrl from '../assets/welcome-deck.pptx?url'
import { parsePptx } from '../parsers/pptxParser'
import { useDocumentsStore } from '../state/documentsStore'

const SAMPLE_FILENAME = 'Welcome to Outcisura.pptx'

/** Imports the bundled walkthrough deck through the normal pptx pipeline (so it gets real pages,
 *  thumbnails and selectable text, exactly like a user's own import). Returns the document id, or
 *  null if it couldn't be imported (e.g. the pptx converter isn't available). Idempotent by
 *  filename: an existing copy is reused rather than duplicated. */
let inFlight: Promise<string | null> | null = null

export function importSampleDeck(): Promise<string | null> {
  // Shared in-flight promise so the tour's background import and a quick click on "Open sample
  // deck" can't both import it.
  inFlight ??= doImport().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function doImport(): Promise<string | null> {
  const existing = useDocumentsStore.getState().documents.find((d) => d.filename === SAMPLE_FILENAME)
  if (existing) return existing.id
  try {
    const response = await fetch(sampleDeckUrl)
    const file = new File([await response.arrayBuffer()], SAMPLE_FILENAME)
    const parsed = await parsePptx(file)
    const record = await window.api.documents.import(parsed)
    await useDocumentsStore.getState().loadDocuments()
    return record.id
  } catch (err) {
    console.warn('Sample deck import failed', err)
    return null
  }
}
