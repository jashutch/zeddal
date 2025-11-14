# Zeddal v1.3.1 Release Notes

**Release Date**: November 14, 2024

---

## 🎉 Major New Feature: Local LLM Integration for Refinement

**100% Offline Workflow is Complete!** Zeddal now supports local LLMs (Ollama, llama.cpp, LM Studio) for AI refinement, completing the fully offline workflow when combined with v1.3.0's local whisper.cpp transcription.

### Key Benefits

- **💰 Zero API costs** for both transcription AND refinement
- **🔒 100% private** - text never leaves your computer
- **🌐 Works completely offline** - no internet required for entire workflow
- **🎯 Multi-model support** - Use any Ollama model (llama3.2, mistral, gpt-oss:20b, qwen2.5:14b, etc.)
- **⚡ Automatic fallback** - Falls back to OpenAI GPT-4 if local LLM fails
- **🔌 Flexible providers** - Supports Ollama, llama.cpp server, LM Studio, OpenAI-compatible APIs

---

## New Features

### 1. Local LLM Integration in LLMRefineService

**Core Integration**: LLMRefineService now uses the pre-existing LocalLLMService for refinement when enabled.

**Implementation Details**:
- Backend selection: Local LLM (Ollama, llama.cpp, etc.) or OpenAI GPT-4
- Automatic fallback: If local LLM fails, gracefully falls back to OpenAI (if API key configured)
- Zero breaking changes: All existing OpenAI functionality preserved
- Dynamic backend switching: Can switch between local and cloud without restart

**New Methods**:
- `initializeLocalLLM()` - Sets up local LLM service based on settings
- `updateBackend()` - Refreshes backend when settings change
- `getBackendName()` - Returns current backend for debugging (e.g., "ollama (gpt-oss:20b)")
- `refineWithLocalLLM()` - Refinement using local LLM with context support

**Architecture**:
```typescript
LLMRefineService
├── refineWithLocalLLM() → LocalLLMService → Ollama/llama.cpp/LM Studio
├── refineWithOpenAI() → OpenAI GPT-4 API
└── Automatic fallback logic
```

### 2. Comprehensive Settings UI for Local LLM

**New Settings Section**: "Local LLM Configuration"

**Features**:
- **Enable Local LLM Toggle**: Turn on/off local LLM refinement
- **Dynamic UI**: Settings show/hide based on enableLocalLLM state
- **Provider Selection**: Dropdown with Ollama (recommended), llama.cpp, LM Studio, OpenAI-compatible
- **API Base URL**: Configurable endpoint (default: http://localhost:11434)
- **Model Name**: Text input supporting ANY model (llama3.2, mistral, gpt-oss:20b, qwen2.5:14b, etc.)
- **API Key**: Optional field for providers that require authentication
- **Test Connection Button**: Validates local LLM is running and model is available
- **In-UI Setup Instructions**: Step-by-step Ollama installation guide
- **Recommended Models List**: Curated list with size/quality trade-offs

**Real-time Feedback**:
- Backend name displayed after toggle (e.g., "LLM backend: ollama (gpt-oss:20b)")
- Test Connection success/failure toasts
- Configuration errors surfaced immediately

### 3. Multi-Model Support

**Flexibility**: Unlike hardcoded model lists, Zeddal accepts any model name as text input.

**Supported Models** (examples):
- **llama3.2** (3B) - Fast, good quality, recommended for most users
- **gpt-oss:20b** (20B) - Large custom model, high quality
- **mistral** (7B) - Balanced speed/quality
- **qwen2.5:14b** (14B) - Excellent for structured note-taking
- **llama3.1:70b** (70B) - Maximum quality for powerful hardware
- **Custom models** - Any Ollama/llama.cpp model

**User-Specific**: Designed to support power users running custom models like gpt-oss:20b.

### 4. Enhanced README Documentation

**New Section**: "Enable Local LLM (Offline Refinement with Ollama)"

**Comprehensive Guide**:
- Step-by-step Ollama installation (macOS, Linux, Windows)
- Model download instructions with examples
- Zeddal configuration steps with screenshots
- Benefits comparison table (offline vs cloud)
- Recommended models for note-taking
- Supported providers list
- Performance expectations

**Updated Sections**:
- Features list highlights local LLM support
- Configuration tables include Local LLM Settings
- Troubleshooting for local LLM issues
- Roadmap marks custom LLM providers as completed

---

## Configuration Changes

### New Settings (Config.ts)

```typescript
// Local LLM settings (already present, now integrated)
enableLocalLLM: false                          // Default to OpenAI
localLLMProvider: 'ollama'                     // Recommended provider
localLLMBaseUrl: 'http://localhost:11434'      // Ollama default
localLLMModel: 'llama3.2'                      // Default model
localLLMApiKey: ''                             // Optional for some providers
```

**Type Definitions** (Types.ts - already present):
```typescript
enableLocalLLM: boolean;
localLLMProvider: 'ollama' | 'llamacpp' | 'lmstudio' | 'openai-compatible' | 'openai';
localLLMBaseUrl: string;
localLLMModel: string;
localLLMApiKey: string;
```

---

## Use Cases

### 100% Offline Workflow

**Perfect for Privacy-Conscious Users**:
1. Local whisper.cpp transcription (v1.3.0)
2. Local Ollama refinement (v1.3.1)
3. Result: Zero data leaves your computer, zero API costs

**Setup**:
```bash
# Install whisper.cpp
brew install whisper-cpp

# Download Whisper model
bash models/download-ggml-model.sh base.en

# Install Ollama
brew install ollama

# Pull LLM model
ollama pull llama3.2

# Configure Zeddal
# 1. Whisper Backend: Local whisper.cpp
# 2. Enable Local LLM: ON
# 3. Model: llama3.2
```

### Hybrid Workflow (Best Quality)

**Balance Cost and Quality**:
1. Local whisper.cpp transcription (free, fast)
2. OpenAI GPT-4 refinement (paid, highest quality)

### Cost-Optimized Workflow

**Minimize API Costs**:
1. Local whisper.cpp transcription (free)
2. Local Ollama with large model (gpt-oss:20b, llama3.1:70b)
3. Only use OpenAI for critical notes

---

## Breaking Changes

**None!** This is a fully backward-compatible release.

- Existing OpenAI users: No action required, everything works as before
- New users: Can choose local LLM during setup
- Settings migration: Automatic, no manual intervention needed
- Local LLM is opt-in: Default remains OpenAI GPT-4

---

## Installation & Setup

### For Existing Users (OpenAI Only)

**No action required!** Plugin will continue using OpenAI API by default.

### For New Local LLM Users

**1. Install Ollama**:
```bash
# macOS (Homebrew)
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Or visit https://ollama.com for other platforms
```

**2. Pull a Model**:
```bash
# Recommended: Fast, good quality
ollama pull llama3.2

# Custom model example
ollama pull gpt-oss:20b

# Other good options
ollama pull mistral        # 7B balanced
ollama pull qwen2.5:14b    # Excellent for notes
```

**3. Verify Ollama is Running**:
```bash
ollama list  # Shows installed models
```

**4. Configure in Zeddal**:
- Settings → Zeddal → Local LLM Configuration
- Enable Local LLM: Toggle ON
- LLM Provider: Select "Ollama (Recommended)"
- API Base URL: `http://localhost:11434` (default)
- Model Name: `llama3.2` (or your preferred model like `gpt-oss:20b`)
- Click "Test Connection" to verify

---

## Performance Considerations

### Local LLM

**Pros**:
- Zero API costs
- No network latency
- 100% private
- Unlimited usage

**Cons**:
- CPU/GPU intensive
- Speed varies by model size and hardware
- Quality varies by model

**Typical Performance** (M1/M2 Mac, 16GB RAM):
- 3B models (llama3.2): 20-30 tokens/sec
- 7B models (mistral): 10-15 tokens/sec
- 14B models (qwen2.5): 5-10 tokens/sec
- 20B models (gpt-oss): 3-7 tokens/sec (requires 32GB+ RAM recommended)

### OpenAI GPT-4

**Pros**:
- Highest quality refinement
- Consistent performance
- No local hardware requirements

**Cons**:
- API costs ($0.01-0.03 per note)
- Requires internet
- Rate limits apply

---

## Known Issues & Limitations

### Local LLM

1. **Hardware Requirements**: Large models (20B+) require significant RAM/VRAM
2. **Initial Model Download**: Models range from 2GB to 40GB
3. **Slower Than Cloud**: Local processing is CPU-bound, varies by hardware
4. **Quality Variance**: Smaller models may produce less polished refinements than GPT-4

### Recommendations

- **8GB RAM**: Use 3B models (llama3.2)
- **16GB RAM**: Use 7B-14B models (mistral, qwen2.5:14b)
- **32GB+ RAM**: Use 20B+ models (gpt-oss:20b, llama3.1:70b)
- **GPU Acceleration**: Install Ollama with CUDA/Metal for 3-10x speedup

---

## Migration Guide

### From v1.3.0 to v1.3.1

**No migration needed!** Simply install v1.3.1 and:
- OpenAI users: Continue as normal
- Want to try local LLM: Follow setup guide above
- Hybrid users: Can switch between backends dynamically

**Settings Compatibility**:
- All v1.3.0 settings preserved
- Local LLM settings already existed in Config.ts, now integrated into UI
- Switching backends does not affect other settings (whisper, RAG, MCP, etc.)

---

## Testing & Validation

**Regression Testing**:
- ✅ All existing OpenAI refinement workflows
- ✅ Local whisper.cpp transcription
- ✅ RAG context integration with local LLM
- ✅ MCP server connections
- ✅ Correction learning system
- ✅ Settings persistence

**New Feature Testing**:
- ✅ Local LLM refinement with Ollama
- ✅ Backend switching (OpenAI ↔ Local)
- ✅ Automatic fallback mechanism
- ✅ Settings UI dynamic display
- ✅ Test Connection validation
- ✅ Multi-model support (llama3.2, mistral, gpt-oss:20b, qwen2.5:14b)

**Build Status**:
- ✅ TypeScript compilation successful
- ✅ Rollup bundle created (~1.1 MB)
- ✅ No breaking changes detected
- ✅ Zero new dependencies added

---

## Technical Details

### Architecture Changes

**Before v1.3.1**:
```
LLMRefineService → OpenAI GPT-4 API (hardcoded)
```

**After v1.3.1**:
```
LLMRefineService
├── Local LLM enabled?
│   ├── Yes → LocalLLMService → Ollama/llama.cpp/LM Studio
│   │         └── On failure → Fallback to OpenAI (if configured)
│   └── No → OpenAI GPT-4 API
```

### Fallback Logic

**Scenario 1**: Local LLM enabled, configured, and working
→ Uses local LLM

**Scenario 2**: Local LLM enabled, but not configured (missing model/URL)
→ Falls back to OpenAI (logs warning)

**Scenario 3**: Local LLM enabled, configured, but fails at runtime
→ Attempts OpenAI fallback (if API key configured)

**Scenario 4**: Local LLM enabled, fails, and no OpenAI API key
→ Surfaces error to user

**Scenario 5**: Local LLM disabled
→ Uses OpenAI GPT-4 (existing behavior)

### LocalLLMService Integration

**Existing Service** (services/LocalLLMService.ts):
- Already existed in codebase with full Ollama support
- Supports multiple providers: Ollama, llama.cpp, LM Studio, OpenAI-compatible
- Provides `refineWithInstruction()` method for voice transcription refinement
- Includes `testConnection()` and `listModels()` utilities

**Integration Points**:
- LLMRefineService now instantiates LocalLLMService when enableLocalLLM is true
- System prompt built in LLMRefineService, passed to LocalLLMService
- RAG context support preserved (context passed to local LLM same as OpenAI)
- Citations, wikilinks, and title generation work identically with both backends

---

## Credits

**Ollama**: https://ollama.com
- Open-source local LLM platform
- Easy model management and API

**llama.cpp**: https://github.com/ggerganov/llama.cpp
- High-performance C++ LLM inference

**Meta**: Llama 3.2 model family
- Fast, capable open-source models

**Mistral AI**: Mistral 7B model
- Balanced performance and quality

**Alibaba Cloud**: Qwen 2.5 model family
- Excellent for structured text

---

## Upgrade Instructions

### Manual Installation

1. Download `zeddal-1.3.1.zip` from GitHub releases
2. Extract to `.obsidian/plugins/zeddal/` in your vault
3. Reload Obsidian or restart the plugin
4. (Optional) Configure local LLM in settings

### Community Plugin (Pending Approval)

Once approved by Obsidian:
1. Settings → Community Plugins
2. Check for updates
3. Update Zeddal to v1.3.1

---

## Support & Feedback

- **Issues**: [GitHub Issues](https://github.com/Outer-H3AV3N/Zeddal/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Outer-H3AV3N/Zeddal/discussions)
- **Documentation**: [README.md](https://github.com/Outer-H3AV3N/Zeddal)

---

## Changelog Summary

### Added
- Local LLM integration in LLMRefineService
- Settings UI section: "Local LLM Configuration"
- Enable Local LLM toggle with dynamic UI
- Provider selection dropdown (Ollama, llama.cpp, LM Studio, OpenAI-compatible)
- Model name text input (supports any model: llama3.2, gpt-oss:20b, etc.)
- Test Connection button with real-time validation
- In-UI Ollama setup instructions
- Recommended models list for note-taking
- README section: "Enable Local LLM (Offline Refinement with Ollama)"
- Local LLM settings table in README
- Automatic fallback from local LLM to OpenAI

### Changed
- LLMRefineService now supports dual backends (local + OpenAI)
- Settings UI dynamically shows/hides local LLM configuration
- README features section highlights local LLM support
- README updated to emphasize 100% offline workflow capability

### Fixed
- None (feature-only release)

### Deprecated
- None

### Removed
- None

### Security
- Enhanced privacy: Local LLM option eliminates cloud data transfer for refinement
- Complete offline workflow: Local whisper.cpp + local Ollama = zero cloud dependency

---

## What's Next (v1.4.0)

**Planned Features**:
- Custom prompt templates for refinement
- Automatic whisper.cpp installation helper
- In-app model download manager for Ollama
- Enhanced correction learning with local LLM support
- Speaker diarization for multi-person recordings

**Target Date**: December 2024

---

**Full Changelog**: https://github.com/Outer-H3AV3N/Zeddal/compare/v1.3.0...v1.3.1
