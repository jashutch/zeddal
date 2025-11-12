# Zeddal v1.1.0 — Conversational Intelligence Release

**Release Date:** November 15, 2025  
**Status:** Stable  
**License:** Business Source License 1.1 (see `LICENSE`)

---

## Overview

Version 1.1.0 transforms Zeddal from a transcription-first utility into a conversational knowledge assistant. The new Q&A mode captures both raw audio and diarized speaker turns, giving you searchable context while keeping the UI lean and predictable. This release also eliminates several long‑standing UX papercuts so daily recording sessions feel calmer and more transparent.

---

## Highlights

### 🧠 Q&A Mode with Rich Audio Context
- Capture question/answer sessions with automatic diarization, ASR, and configurable speaker/audience labels.
- Raw audio for every turn is preserved alongside refined text so you can re-process or audit at any time.
- Works seamlessly with Vault-aware refinement and linking, meaning your conversations enrich your graph immediately.

### 🎛️ User-Controlled Audio Persistence
- Decide per session whether to save or discard source audio; no more automatic clutter or accidental retention.
- Duplicate filename protection prevents crashes when re-recording with similar titles.

### 🎯 Cleaner Recording Experience
- Clear progress indicators for upload, transcription, refinement, and linking steps—no more guessing what the plugin is doing.
- Console spam during recording has been removed, dramatically reducing noise for power users running DevTools.

### 🗣️ Speaker Intelligence Everywhere
- Full diarization pipeline exposes who is speaking throughout the transcript.
- UI now supports user-configurable names for speakers and audiences, making transcripts far easier to scan or export.

---

## Upgrade Notes

1. Update to v1.1.0 through the Obsidian Community Plugins tab (or copy the new `main.js`, `manifest.json`, and `styles.css` from this release).
2. Open Zeddal Settings → Recording to set your preferred audio retention policy and default speaker labels.
3. Use the new Q&A Mode toggle in the Record modal whenever you’re capturing interviews, meetings, or brainstorming dialogues.

---

## Known Issues

- Q&A mode currently records diarization metadata inside the note frontmatter; a future update will offer a cleaner table layout.
- Whisper API latency can still spike for recordings longer than ~20 minutes—watch the progress indicators to confirm each stage completes.

---

Need help or want to share feedback? Open an issue or drop a note in the community channel—community stories fuel the roadmap. 
