# Flashcards

Import a PDF or PPTX, click on parts of a slide to turn them into flashcards, edit or AI-regenerate them, and jump back to the source slide from any card.

## Setup

```bash
npm install
npx electron-rebuild -f -w better-sqlite3   # only needed once, or after changing Electron/Node versions
cp .env.example .env                        # then fill in ANTHROPIC_API_KEY for AI regenerate
npm run dev
```

**PPTX import also requires [LibreOffice](https://www.libreoffice.org/download/)** (`brew install --cask libreoffice` on macOS) — slides are converted to PDF via headless LibreOffice for pixel-accurate rendering, then handled by the same pipeline as a native PDF. If `soffice` isn't found, PPTX import fails with a clear error; PDF import doesn't need it at all.

## What's here

- **Library tab** — import `.pdf`/`.pptx`, browse slides, click elements to select them, "Create Flashcard" (or "Image Occlusion…" for a selected image, or "Add to combined card" with Combine mode on).
- **Cards tab** — edit front/back, regenerate with Claude, delete, and jump back to any source slide via the 🔗 chips.
- Data lives in SQLite + cached images under Electron's `userData` directory — nothing leaves your machine except the text/images sent to Claude during a regenerate.

## Known limits (by design, for v1)

- No study/review queue yet — this is capture-and-edit only.
- PPTX conversion happens via a real LibreOffice process per import, so it's a bit slower than a native PDF and requires LibreOffice to be installed.
