# Zeddal v1.3.0 Release Notes

**Release Date**: November 14, 2024

---

## 🎉 Major New Feature: Local Whisper.cpp Integration

**Offline transcription is here!** Zeddal now supports local whisper.cpp for completely private, free, and offline transcription.

### Key Benefits

- **💰 Zero API costs** for transcription
- **🔒 100% private** - audio never leaves your computer
- **🌐 Works completely offline** - no internet required for transcription
- **⚡ Fast processing** for small to medium recordings
- **🎯 Optional refinement** - still use GPT-4 for enhancement if desired

---

## New Features

### 1. Whisper Backend Abstraction Layer

**Backend Architecture Redesign**: Complete refactoring of the transcription system using the Strategy pattern for extensibility.

**New Files**:
- `services/whisper/IWhisperBackend.ts` - Interface for transcription backends
- `services/whisper/OpenAIWhisperBackend.ts` - Cloud-based transcription (existing functionality)
- `services/whisper/LocalWhisperBackend.ts` - Local whisper.cpp integration

**WhisperService Enhancements**:
- Backend selection based on configuration
- Automatic fallback to OpenAI if local backend fails
- Graceful degradation for invalid configurations
- Zero breaking changes - all existing APIs preserved

### 2. Settings UI for Backend Configuration

**New Settings Section**: "Whisper Backend Configuration"

**Features**:
- **Backend Selector**: Choose between OpenAI API (cloud) or Local whisper.cpp (offline)
- **Smart UI**: Settings dynamically show/hide based on selected backend
- **Configuration Fields**:
  - Whisper.cpp Binary Path
  - Whisper Model Path (GGML format)
  - Language Override (auto-detect or specific language)
- **Backend Status Indicator**: Real-time validation of configuration
- **Test Configuration Button**: Verify setup before recording
- **In-UI Setup Instructions**: Step-by-step guidance for local whisper setup

### 3. Local Whisper.cpp Support

**Implementation Details**:
- Spawns whisper.cpp as subprocess using Node.js `child_process`
- Saves audio blobs to temporary files (auto-cleanup)
- Parses whisper.cpp stdout for transcription results
- Supports all whisper.cpp command-line options
- 60-second timeout for long recordings
- Language code support (`en`, `es`, `fr`, etc.)

**Supported Models**:
- Tiny (75 MB) - Fast, lower accuracy
- Base (142 MB) - Balanced
- Small (466 MB) - Good accuracy
- Medium (1.5 GB) - High accuracy
- Large (3 GB) - Best accuracy

### 4. Automatic Fallback Mechanism

**Intelligent Fallback Logic**:
1. If local backend selected but not configured → auto-fallback to OpenAI
2. If local transcription fails → attempt OpenAI fallback
3. If OpenAI also fails → surface error to user
4. All fallbacks logged to console for debugging

**User Experience**:
- Seamless experience - no interruption to workflow
- Console warnings for configuration issues
- Graceful degradation maintains functionality

---

## Configuration Changes

### New Settings (Config.ts)

```typescript
// Whisper Backend settings (v1.3.0)
whisperBackend: 'openai'                    // Default to OpenAI API
whisperCppPath: '/usr/local/bin/whisper'   // Default binary path
whisperModelPath: ''                        // User must configure
whisperLanguage: 'auto'                     // Auto-detect language
```

**Type Definitions** (Types.ts):
```typescript
whisperBackend: 'openai' | 'local-cpp' | 'local-python' | 'wasm';
whisperCppPath: string;
whisperModelPath: string;
whisperLanguage: string;
```

---

## Documentation Updates

### README.md Enhancements

**New Sections**:
- **Quick Start: Enable Local Whisper** - Installation and setup guide
- **Whisper Backend Settings Table** - Configuration reference
- **Troubleshooting: Local whisper.cpp** - Debug guide
- **Privacy & Security** - Updated to highlight local option
- **Project Structure** - Shows new backend architecture

**Updated Sections**:
- Features list highlights flexible backend
- API costs troubleshooting recommends local option
- Roadmap marks offline transcription as completed

---

## Technical Details

### Architecture

**Pattern Used**: Strategy Pattern with Facade
- `IWhisperBackend` - Strategy interface
- `OpenAIWhisperBackend` - Concrete strategy (cloud)
- `LocalWhisperBackend` - Concrete strategy (local)
- `WhisperService` - Facade/Context

**Benefits**:
- Easy to add new backends (whisper.py, WASM, etc.)
- Backend-specific logic isolated
- Testable and maintainable
- Zero coupling between backends

### Performance Considerations

**Local Whisper**:
- CPU-bound processing
- Speed depends on model size and CPU
- Typical: 1-5x real-time (base model on modern CPU)
- No network latency

**OpenAI API**:
- Network-bound processing
- Speed depends on internet connection
- Typical: 2-10 seconds regardless of audio length
- Concurrent request limits apply

### File Handling

**Temporary Files**:
- Created in system temp directory: `/tmp/zeddal-whisper/`
- Auto-cleanup after transcription
- Cleanup on plugin shutdown
- Failed transcriptions also cleaned up

**Supported Audio Formats**:
- WAV (recommended for whisper.cpp)
- WebM (browser recording default)
- MP4, MPEG, OGG (with conversion)

---

## Breaking Changes

**None!** This is a fully backward-compatible release.

- Existing OpenAI users: No action required, everything works as before
- New users: Can choose backend during initial setup
- Settings migration: Automatic, no manual intervention needed

---

## Installation & Setup

### For Existing Users (OpenAI Only)

**No action required!** Plugin will continue using OpenAI API by default.

### For New Local Whisper Users

**1. Install whisper.cpp**:
```bash
# macOS (Homebrew)
brew install whisper-cpp

# Or build from source
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
make
```

**2. Download GGML Model**:
```bash
cd whisper.cpp
bash models/download-ggml-model.sh base.en  # ~150MB
```

**3. Configure in Zeddal**:
- Settings → Zeddal → Whisper Backend Configuration
- Select "Local whisper.cpp (offline)"
- Set binary path (e.g., `/usr/local/bin/whisper`)
- Set model path (e.g., `/path/to/ggml-base.en.bin`)
- Click "Test Configuration"

---

## Known Issues & Limitations

### Local Whisper.cpp

1. **macOS/Linux Only**: Currently requires Unix-like environment (Electron on Windows may need adjustments)
2. **Initial Setup Required**: Must manually install whisper.cpp and download models
3. **CPU Intensive**: Transcription uses CPU, may slow down computer during processing
4. **Model Storage**: Models range from 75MB to 3GB disk space
5. **No Streaming**: Processes complete audio chunk at once (not real-time)

### Planned Improvements (Future Releases)

- Automatic whisper.cpp installation (v1.4.0)
- Model download manager in settings UI (v1.4.0)
- Windows support verification (v1.4.0)
- WASM whisper backend for browser (v1.5.0)
- Whisper.py integration option (v1.5.0)
- Real-time streaming transcription (v2.0.0)

---

## Migration Guide

### From v1.2.0 to v1.3.0

**No migration needed!** Simply install v1.3.0 and:
- OpenAI users: Continue as normal
- Want to try local: Follow setup guide above

**Settings Compatibility**:
- All v1.2.0 settings preserved
- New whisper backend settings added with safe defaults
- Switching backends does not affect other settings

---

## Testing & Validation

**Regression Testing**:
- ✅ All existing OpenAI transcription workflows
- ✅ GPT-4 refinement with both backends
- ✅ RAG context integration
- ✅ MCP server connections
- ✅ Correction learning system
- ✅ Audio recording and playback

**New Feature Testing**:
- ✅ Local whisper.cpp basic transcription
- ✅ Backend switching (OpenAI ↔ Local)
- ✅ Fallback mechanisms
- ✅ Settings UI dynamic display
- ✅ Configuration validation
- ✅ Temp file cleanup

**Build Status**:
- ✅ TypeScript compilation successful
- ✅ Rollup bundle created (1.1 MB)
- ✅ No breaking changes detected
- ✅ All tests pass (where applicable)

---

## Credits

**whisper.cpp**: https://github.com/ggerganov/whisper.cpp
- Georgi Gerganov (@ggerganov) and contributors
- High-performance C++ implementation of OpenAI Whisper

**OpenAI Whisper**: https://github.com/openai/whisper
- Original model and research

---

## Upgrade Instructions

### Manual Installation

1. Download `zeddal-1.3.0.zip` from GitHub releases
2. Extract to `.obsidian/plugins/zeddal/` in your vault
3. Reload Obsidian or restart the plugin
4. (Optional) Configure local whisper in settings

### Community Plugin (Pending Approval)

Once approved by Obsidian:
1. Settings → Community Plugins
2. Check for updates
3. Update Zeddal to v1.3.0

---

## Support & Feedback

- **Issues**: [GitHub Issues](https://github.com/jashutch/zeddal/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jashutch/zeddal/discussions)
- **Documentation**: [README.md](https://github.com/jashutch/zeddal)

---

## Next Release Preview (v1.4.0)

**Planned Features**:
- Automatic whisper.cpp installation
- In-app model download manager
- Windows compatibility verification
- Custom prompt templates for refinement
- Enhanced correction learning analytics

**Target Date**: December 2024

---

## Changelog Summary

### Added
- Local whisper.cpp backend for offline transcription
- Backend abstraction layer (IWhisperBackend interface)
- Whisper Backend Configuration settings section
- Backend selection dropdown in settings
- Test Configuration button for validation
- Automatic fallback from local to OpenAI
- In-UI setup instructions for local whisper
- Comprehensive README documentation for local setup
- Troubleshooting guide for local whisper issues

### Changed
- Refactored WhisperService to use backend pattern
- Extracted OpenAI logic to OpenAIWhisperBackend
- Updated README features to highlight backend flexibility
- Enhanced privacy section to mention local option
- Marked offline transcription as completed in roadmap

### Fixed
- None (new feature release)

### Deprecated
- None

### Removed
- None

### Security
- Enhanced privacy: Local option eliminates cloud data transfer for transcription
- Audio processing can now be 100% offline

---

**Full Changelog**: https://github.com/jashutch/zeddal/compare/v1.2.0...v1.3.0
