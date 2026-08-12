import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Common install locations, tried in order, in case `soffice` isn't on PATH. */
const SOFFICE_CANDIDATES = [
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
]

/** Converts a .pptx file to .pdf via headless LibreOffice, for pixel-accurate slide rendering. */
export async function convertPptxToPdf(pptxBytes: Buffer): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'flashcard-pptx-'))
  const inputPath = join(dir, 'slide.pptx')
  writeFileSync(inputPath, pptxBytes)

  try {
    await runSoffice(dir, inputPath)
    return readFileSync(join(dir, 'slide.pdf'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runSoffice(outDir: string, inputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tryCandidate(0)

    function tryCandidate(index: number): void {
      if (index >= SOFFICE_CANDIDATES.length) {
        reject(
          new Error(
            'LibreOffice was not found. Install it from https://www.libreoffice.org/download/ (or `brew install --cask libreoffice` on macOS) to import PPTX files.'
          )
        )
        return
      }

      const proc = spawn(SOFFICE_CANDIDATES[index], [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        inputPath
      ])

      let stderr = ''
      proc.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      proc.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          tryCandidate(index + 1)
        } else {
          reject(err)
        }
      })
      proc.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`LibreOffice conversion failed (exit ${code}): ${stderr.trim()}`))
      })
    }
  })
}
