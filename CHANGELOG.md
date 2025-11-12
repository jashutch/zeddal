# Changelog

All notable changes to Zeddal will be documented in this file.

## [1.0.0] - 2025-01-XX

### Initial Release

#### Core Features
- **Voice Recording**: High-quality audio recording with real-time waveform visualization
- **Automatic Transcription**: Powered by OpenAI Whisper API with 100+ language support
- **Automatic Language Detection**: Seamlessly detects and transcribes in any supported language
- **Automatic Translation**: Optional translation to English for multilingual workflows
- **AI Refinement**: GPT-4 powered text enhancement for clarity and readability
- **Smart Context Linking**: Automatic detection and linking to existing vault notes
- **Save Anywhere**: Insert voice notes into current note, new note, or specific location

#### Advanced Features
- **RAG Context Integration**: Vector-based semantic search of vault content
  - Retrieves relevant context during transcription refinement
  - Configurable top-K results and chunk sizes
  - Automatic embedding generation and caching
- **MCP (Model Context Protocol) Support**: Connect to external context servers
  - Retrieve resources from MCP-compatible servers
  - Combine internal vault context with external knowledge
  - Configurable server connections via stdio transport
- **Audio File Management**:
  - Save recordings automatically with metadata
  - Browse recording history with search
  - Re-process existing recordings with different settings
  - Audio playback within Obsidian

#### User Experience
- **Real-time Feedback**: Visual and audio cues throughout recording workflow
- **Configurable Settings**: Extensive customization options
- **Error Recovery**: Graceful degradation when services unavailable
- **Multiple Save Modes**: Flexible note insertion strategies
- **Toast Notifications**: Non-intrusive status updates

#### Language Support
- **100+ Languages Supported** including:
  - Afrikaans, Arabic, Armenian, Azerbaijani, Belarusian, Bosnian, Bulgarian
  - Catalan, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian
  - Finnish, French, Galician, German, Greek, Hebrew, Hindi, Hungarian
  - Icelandic, Indonesian, Italian, Japanese, Kannada, Kazakh, Korean
  - Latvian, Lithuanian, Macedonian, Malay, Marathi, Maori, Nepali, Norwegian
  - Persian, Polish, Portuguese, Romanian, Russian, Serbian, Slovak, Slovenian
  - Spanish, Swahili, Swedish, Tagalog, Tamil, Thai, Turkish, Ukrainian
  - Urdu, Vietnamese, Welsh
  - And 70+ more languages with automatic detection

#### Technical Architecture
- Service-oriented design with clean separation of concerns
- Event-driven communication via EventBus
- Type-safe configuration management
- Modular service architecture for extensibility
- Vector database integration for RAG
- MCP protocol implementation for external context

### Dependencies
- OpenAI API (Whisper, GPT-4, Embeddings)
- Model Context Protocol SDK (optional)
- Obsidian API 0.15.0+
