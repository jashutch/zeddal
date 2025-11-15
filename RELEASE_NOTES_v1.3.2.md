# Zeddal v1.3.2 Release Notes

**Release Date:** November 15, 2024

---

## 🎉 Major New Feature: Q&A Session Intelligence

Zeddal now ships with a fully interactive Q&A workflow that captures speaker turns, diarizes the conversation, and preserves the raw audio for every exchange. Combined with v1.3.0's local whisper.cpp support and v1.3.1's local LLM refinement, v1.3.2 completes the "meeting-to-note" handoff entirely offline.

### Key Benefits

- **🧠 Structured conversations** – diarization + ASR keep question/answer sequences obvious at a glance
- **🎙️ Raw audio safety net** – optional per-session toggles to save or discard microphone captures
- **🚦 Transparent processing** – visual upload/transcribe/refine indicators replace console spam
- **🛡️ Crash-proof recordings** – duplicate filename detection and smarter storage paths prevent collisions
- **🔧 Local-first ready** – built-in ffmpeg conversion + settings UI make whisper.cpp flows turnkey

---

## New Features

### 1. Q&A Session Mode
- **Two-column transcript view** with speaker & audience labels the user can define at record time.
- **Automatic diarization** reorders turns even when multiple participants speak back to back.
- **Dual exports** generate both Markdown and JSON artifacts for downstream automation.
- **Vault-aware refinement** still runs so long answers inherit existing terminology, links, and citations.

### 2. Recording UX & Audio Persistence Upgrades
- **Per-session audio retention** switch: keep raw WebM clips for compliance or discard them instantly.
- **Raw audio metadata** now attaches to saved voice-note entries so you can reprocess locally later.
- **Progress toasts** for upload, transcription, refinement, and linking replace console spam.
- **Confidence meter smoothing** reduces flicker during live capture, mirroring the new status bar.
- **Duplicate-safe storage** ensures two recordings with the same title land in unique folders, eliminating the crash reported in 1.3.1.

### 3. Local Whisper Pipeline Polish
- **Automatic WebM → WAV conversion** using ffmpeg, so whisper.cpp never rejects Chrome/Obsidian recordings.
- **Configurable ffmpeg path** in Settings → Whisper Backend Configuration for users with custom installs.
- **Extended fallback logging** clearly surfaces when Zeddal switches from local whisper.cpp to the OpenAI API.

### 4. Documentation & Guidance
- **Release bundle** now includes v1.3.2 notes, setup checklists, and licensing guidance so contributors understand the Business Source License and CLA at a glance.

---

## Configuration & Settings Changes

- `Config.ts` + `Types.ts` gained a persistent `ffmpegPath` option. Defaults to `ffmpeg` (PATH lookup) but may be pointed at `/opt/homebrew/bin/ffmpeg`, Windows builds, or containerized binaries.
- Whisper backend settings expose the new ffmpeg path input whenever `local-cpp` is selected.
- Recorder defaults now remember your last "save raw audio" preference for both classic and Q&A sessions.

---

## Use Cases

### 100% Offline Interviews
1. Enable `local-cpp` + set your whisper.cpp model path.
2. Install Ollama (or your preferred local LLM) and enable Local LLM refinement.
3. Toggle Q&A Mode before recording. Speaker labels + diarization keep transcripts searchable.
4. Save raw WebM + Markdown results locally for full audit trails.

### Hybrid Team Summaries
- Keep whisper.cpp local to eliminate audio egress costs.
- Let refinement fall back to GPT-4 automatically when quality matters most.
- Use the new duplicate-safe history browser to re-run select clips via cloud APIs when bandwidth returns.

### Classroom & Research Sessions
- Prompt for speaker names (e.g., Professor / Cohort) and export JSON to feed lab notebooks or RAG datasets.
- Discard raw audio automatically when privacy policies require it—only the structured transcript remains.

---

## Installation & Setup Highlights

1. **Update** via Community Plugins or copy `main.js`, `manifest.json`, and `styles.css` from `zeddal-1.3.2.zip`.
2. **Configure Q&A Mode**: open Settings → Zeddal → Recording → enable Q&A prompts + default labels.
3. **Set Local Whisper Paths** (optional): enter whisper.cpp binary, GGML model, and ffmpeg path.
4. **Enable Local LLM** (optional): toggle on, pick Ollama/llamacpp/LM Studio, enter base URL + model, then run the built-in connection test.

---

## Known Issues & Limitations

- Q&A mode currently stores diarization metadata in YAML frontmatter; a tabular Markdown view is on the roadmap.
- Local whisper.cpp inherits ffmpeg's codec support; ensure ffmpeg 6.0+ is installed for pcm_s16le output.
- Extremely long recordings (>30 min) may still spike whisper.cpp memory usage—watch the Obsidian console for warnings.

---

## Testing & Validation

- ✅ Local whisper.cpp runs verified on Apple Silicon (ggml-medium.en).
- ✅ Ollama refinement tested with `gpt-oss:20b` & `llama3.2` plus fallback to GPT-4.
- ✅ Duplicate filename guard regression-tested by re-recording identical titles.
- ✅ Status bar + toasts exercised on macOS and Windows Obsidian builds.

---

## Assets

- `zeddal-1.3.2.zip`
- Source code (zip / tar.gz) generated by GitHub automatically at release publish time.

Need help or want to showcase your workflow? Drop a note in the community channel or open an issue so we can keep iterating on the offline-first experience.
