import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LIBREOFFICE_MISSING_MESSAGE, resolveSoffice } from './libreOffice'

/** Converts a .pptx file to .pdf via headless LibreOffice, for pixel-accurate slide rendering.
 *  Whichever LibreOffice is available is used — a system install if there is one, otherwise the
 *  copy fetched on demand into userData (see libreOffice.ts). */
export async function convertPptxToPdf(pptxBytes: Buffer): Promise<Buffer> {
  // The renderer normally checks for LibreOffice before it gets this far (so the download prompt
  // appears instead of an error); this is the backstop for it going missing mid-session.
  const soffice = resolveSoffice()
  if (!soffice) throw new Error(LIBREOFFICE_MISSING_MESSAGE)

  const dir = mkdtempSync(join(tmpdir(), 'flashcard-pptx-'))
  const inputPath = join(dir, 'slide.pptx')
  writeFileSync(inputPath, pptxBytes)

  try {
    await runSoffice(soffice, dir, inputPath)
    return readFileSync(join(dir, 'slide.pdf'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runSoffice(soffice: string, outDir: string, inputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath])

    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    proc.on('error', (err) => reject(err))
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`LibreOffice conversion failed (exit ${code}): ${stderr.trim()}`))
    })
  })
}
