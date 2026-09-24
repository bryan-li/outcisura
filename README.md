# Outcisura

Flashcards cut straight out of your PDF, PPTX and video lectures.

Import a lecture, drag over the bits that matter, and they become cards — text, image occlusions, cloze deletions or picture cards. Every card keeps a link back to the exact region of the exact slide it came from, so "why is this the answer?" is always one click away. Then review them, generate mock exam papers from them, or put them up on a projector and run the room through a live quiz.

Desktop app (macOS/Windows/Linux, Electron). Your cards live in local SQLite and work fully offline; signing in adds cloud sync and the social features.

## Setup

```bash
npm install
npx electron-rebuild -f -w better-sqlite3   # once, or after changing Electron/Node versions
cp .env.example .env                        # fill in the Supabase URL/key for sync and AI
npm run dev
```

**PPTX import needs LibreOffice**, but you don't have to install it yourself — slides go through headless LibreOffice to PDF for pixel-accurate rendering, then down the same pipeline as a native PDF. If you already have it, that copy is used as-is; if not, the first PPTX import offers a one-time ~300 MB download that installs into the app's own data directory and leaves your system untouched. PDF import never needs it.

## Capture

- **Import** `.pdf`, `.pptx` and video files (PPTX fetches LibreOffice on first use — see Setup). Documents live in a foldered Library you can nest and reorder.
- **Select elements on a slide** — click them, or marquee-drag across several (the band auto-scrolls near an edge). Turn a selection into a card, or free-hand drag any region for a screenshot.
- **Card types**: basic front/back, **image occlusion** (black out regions of an image so the card asks what's underneath), **cloze** (`{{hidden}}` spans in a passage), and **picture** cards.
- **Combine mode** gathers selections from any number of slides or documents into one card instead of creating them one at a time.
- **Video**: scrub a timeline, capture a paused frame as a page (the whole occlusion pipeline then works on it), or mark a `[start, end)` range. Audio is transcribed locally with Whisper, and a transcribed span can become a card with the timestamp as its backlink.
- **OCR** (Tesseract) pulls text out of slides that are just images.
- **Slide finder** — the toolbar's slide counter opens a popover that searches every slide's text, jumps to a slide number, or filters to slides you've already made cards from. `Cmd/Ctrl+F` opens it, `Home`/`End` jump to the ends, arrows step.
- **AI generation** drafts cards from the sources you selected, regenerates a card you don't like, and can summarise a whole document.

## Study

- **Spaced repetition** — a 4-button SM-2 variant (again/hard/good/easy). Each grade button shows when that choice would bring the card back before you press it, and "again" requeues the card later in the same session.
- **Review dashboard** — start a session over everything or just the folders you tick; streak, today's count, average session length, and how your collection is maturing.
- **Graph** — cards, folders and source documents as one force-directed map, so clusters and orphans are visible at a glance.
- **Exam papers** — upload a past paper to infer its structure as a template, then generate a fresh paper from a folder's cards against that structure. Sit the paper in-app and have it marked, with every question backlinked to the card it came from.
- **Pomodoro timer** floats above every view, including mid-review.
- **Search** (`Cmd/Ctrl+K`) across card text and document filenames.

## Live sessions

Host a deck (or a generated paper) as a real-time quiz:

- Players join with a six-character code, as a guest with no account or signed in as themselves.
- **The host sets the answering window per question** — pick a preset in the lobby or mid-game, and changing it re-times the question already running.
- **Questions close on their own** when every player has answered, or when the clock runs out, or when the host reveals early.
- Speed-ranked scoring, a per-question correctness breakdown, and a running leaderboard between questions.
- Free-text answers are graded against a rubric; MCQs against the key. Players answer from the keyboard alone — `1`–`9` to pick, `Enter` to submit.

## Sync and sharing

- **Local-first sync**: SQLite is always the read/write path; the sync engine pushes and pulls against Supabase in the background, so the app keeps working offline and reconciles later.
- **Friends** — send and accept requests, then share a folder with any accepted friend.
- **Publish a deck** publicly (subject to an approval queue) for anyone to import.
- **Missing Sources** catches cards whose source images didn't make it across a device pull, and offers to recapture the region from a local document, upload a replacement, or dismiss it.
- **Anki**: import `.apkg` decks, and export any folder back out to `.apkg`.

## Account, AI and updates

- AI runs through a hosted proxy on a **plan + monthly credits** model (free and paid tiers) rather than asking you for an API key.
- **Self-updating** with a download/install banner, plus a manual check in Settings.
- Light/dark/system themes, a zoom control, and a first-run intro tour you can replay from Settings.

## Data

Everything is under Electron's `userData` directory: SQLite for cards, folders and review history, plus cached page renders, element crops and imported videos on disk. Nothing leaves the machine unless you sign in (sync, friends, live sessions) or use an AI feature, which sends only the text and images for that request.

## Scripts

```bash
npm run dev         # electron-vite dev
npm run build       # bundle main, preload and renderer
npm run typecheck   # tsc for main/preload and renderer
npm run dist:mac    # packaged build via electron-builder
```
