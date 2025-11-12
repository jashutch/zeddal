# Zeddal

**AI-Powered Voice Notes for Obsidian**

Transform your voice into perfectly formatted, context-aware notes with automatic transcription in 100+ languages, intelligent linking, and RAG-enhanced refinement.

---

## Features

### 🎙️ Voice Recording
- **High-Quality Audio Capture**: Professional-grade recording with automatic silence detection
- **Visual Feedback**: Real-time waveform visualization during recording
- **Flexible Controls**: Pause, resume, and stop with keyboard shortcuts
- **Audio Management**: Browse, playback, and re-process saved recordings

### 🌍 Multilingual Transcription
- **100+ Languages Supported**: Automatic language detection across all major languages
- **Automatic Translation**: Optional translation to English for multilingual workflows
- **Zero Configuration**: No language selection needed—just speak naturally
- **High Accuracy**: Powered by OpenAI's Whisper API

### ✨ AI Refinement
- **Intelligent Enhancement**: GPT-4 automatically improves clarity and readability
- **Context-Aware**: Considers vault content when refining transcriptions
- **Configurable**: Choose refinement strength and style
- **Preserves Intent**: Maintains your original meaning while improving structure

### 🔗 Smart Context Linking
- **Automatic Note Detection**: Finds and links mentions of existing notes
- **Intelligent Matching**: Fuzzy matching handles variations and plurals
- **Zero Friction**: Links added automatically during refinement
- **Vault Integration**: Seamlessly connects voice notes to your knowledge base

### 🧠 RAG Context Integration
- **Semantic Search**: Vector-based retrieval of relevant vault content
- **Dynamic Context**: Automatically includes related notes during refinement
- **Configurable Retrieval**: Adjust chunk size, overlap, and top-K results
- **Efficient Caching**: Fast lookups with automatic embedding generation

### 🔌 MCP Support (Model Context Protocol)
- **External Context**: Connect to MCP servers for additional knowledge sources
- **Flexible Integration**: Support for multiple concurrent MCP connections
- **Stdio Transport**: Compatible with standard MCP server implementations
- **Optional Enhancement**: Graceful degradation if unavailable

### 💾 Flexible Saving
- **Insert Anywhere**: Current note, new note, or specific location
- **Smart Defaults**: Configurable default save behavior
- **Metadata Preservation**: Keep audio files linked to transcriptions
- **Organized Storage**: Automatic organization in configurable folders

---

## Installation

### Manual Installation (Recommended for Early Access)

1. Download the latest release from [GitHub Releases](https://github.com/jashutch/zeddal/releases)
2. Extract the files to your Obsidian vault's plugin folder:
   ```
   VaultFolder/.obsidian/plugins/zeddal/
   ```
3. Enable the plugin in Obsidian Settings → Community Plugins
4. Configure your OpenAI API key (see Configuration below)

### Community Plugin Installation (Coming Soon)

Once approved by Obsidian:
1. Open Settings → Community Plugins
2. Search for "Zeddal"
3. Click Install → Enable
4. Configure your OpenAI API key

---

## Quick Start

### 1. Configure OpenAI API Key

1. Open Settings → Zeddal
2. Enter your [OpenAI API key](https://platform.openai.com/api-keys)
3. (Optional) Customize models and settings

### 2. Record Your First Voice Note

1. Click the microphone icon in the ribbon (left sidebar)
2. Allow microphone access when prompted
3. Speak naturally in any supported language
4. Click "Stop Recording" when finished
5. Review the transcription and refinement
6. Choose where to save your note

### 3. Advanced Features

#### Enable RAG Context
1. Settings → Zeddal → RAG Settings
2. Enable "Use RAG Context"
3. Adjust retrieval parameters if needed
4. Your vault content will now inform AI refinements

#### Connect MCP Servers
1. Settings → Zeddal → MCP Settings
2. Enable "Use MCP Context"
3. Add server configurations:
   ```json
   {
     "id": "my-server",
     "name": "My Knowledge Base",
     "enabled": true,
     "command": "node",
     "args": ["/path/to/server.js"],
     "env": {}
   }
   ```

---

## Configuration

### API Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **OpenAI API Key** | Your OpenAI API key (required) | - |
| **GPT Model** | Model for refinement | `gpt-4-turbo` |
| **Whisper Model** | Transcription model | `whisper-1` |
| **Embedding Model** | For RAG context | `text-embedding-3-small` |

### Recording Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Silence Threshold** | RMS level for silence detection | `0.01` |
| **Silence Duration** | Auto-pause delay (ms) | `1500` |
| **Recordings Path** | Audio file storage location | `Voice Notes/Recordings` |

### Note Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Default Save Location** | Where to insert notes | `ask` |
| **Voice Notes Folder** | Default folder for new notes | `Voice Notes` |
| **Auto Refine** | Enable AI refinement | `true` |
| **Auto Context Links** | Enable automatic linking | `true` |

### RAG Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable RAG** | Use vault context | `true` |
| **Top K Results** | Number of chunks to retrieve | `3` |
| **Chunk Size** | Tokens per chunk | `500` |
| **Chunk Overlap** | Token overlap | `50` |

### MCP Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable MCP** | Connect to MCP servers | `false` |
| **MCP Servers** | Server configurations | `[]` |

---

## Language Support

Zeddal supports **100+ languages** with automatic detection:

### Major Languages
Afrikaans • Arabic • Armenian • Azerbaijani • Belarusian • Bosnian • Bulgarian • Catalan • Chinese • Croatian • Czech • Danish • Dutch • English • Estonian • Finnish • French • Galician • German • Greek • Hebrew • Hindi • Hungarian • Icelandic • Indonesian • Italian • Japanese • Kannada • Kazakh • Korean • Latvian • Lithuanian • Macedonian • Malay • Marathi • Maori • Nepali • Norwegian • Persian • Polish • Portuguese • Romanian • Russian • Serbian • Slovak • Slovenian • Spanish • Swahili • Swedish • Tagalog • Tamil • Thai • Turkish • Ukrainian • Urdu • Vietnamese • Welsh

### Regional Variants
Plus 50+ additional languages and dialects including Assamese, Bengali, Gujarati, Hausa, Javanese, Khmer, Lao, Malayalam, Maltese, Mongolian, Myanmar, Pashto, Punjabi, Sanskrit, Shona, Sindhi, Sinhala, Somali, Sundanese, Tajik, Telugu, Turkmen, Uzbek, Yoruba, and more.

**Translation**: Optionally translate any language to English during refinement.

---

## Keyboard Shortcuts

| Action | Default Shortcut |
|--------|-----------------|
| Start Recording | Click ribbon icon |
| Stop Recording | Click "Stop" button |
| Cancel Recording | Click "Cancel" button |

*Custom shortcuts can be configured in Obsidian Settings → Hotkeys*

---

## Troubleshooting

### "Please configure OpenAI API key in settings"

**Solution**: Add your OpenAI API key in Settings → Zeddal → OpenAI API Key

Get your key at: https://platform.openai.com/api-keys

### Microphone not working

**Solution**: Check browser/system permissions for microphone access

1. Obsidian Settings → About → Check console for errors
2. System Settings → Privacy & Security → Microphone
3. Try restarting Obsidian

### Transcription fails or returns empty

**Possible causes**:
- Invalid API key
- Network connectivity issues
- Audio file too short (< 0.1 seconds)
- Audio quality too low

**Solutions**:
1. Verify API key is correct
2. Check internet connection
3. Ensure adequate recording length
4. Test microphone in other applications

### RAG context not working

**Solution**: Ensure embeddings are enabled and vault has indexable content

1. Settings → Zeddal → Enable RAG
2. Wait for initial vault indexing
3. Check console for embedding errors

### MCP servers not connecting

**Solution**: Verify MCP server configuration

1. Check server command and args are correct
2. Ensure server executable is accessible
3. Review console for connection errors
4. Test server independently

### High API costs

**Solutions**:
- Disable auto-refinement and refine selectively
- Reduce RAG top-K results
- Use smaller embedding model
- Disable MCP if not needed

---

## Privacy & Security

### Data Handling
- **Audio Processing**: Recordings sent to OpenAI Whisper API
- **Text Refinement**: Transcriptions processed by OpenAI GPT-4
- **Embeddings**: Vault content embedded via OpenAI Embeddings API
- **Local Storage**: Audio files and metadata stored in your vault
- **No Telemetry**: Zeddal does not collect usage data

### OpenAI Data Policy
Per [OpenAI's data policy](https://openai.com/policies/api-data-usage-policies):
- API data is not used to train models
- Data is retained for 30 days for abuse monitoring
- Zero data retention option available for enterprise

### Recommendations
- Use API keys with usage limits
- Review OpenAI's terms of service
- Consider self-hosted alternatives for sensitive content
- Enable MCP servers only from trusted sources

---

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/jashutch/zeddal.git
cd zeddal

# Install dependencies
npm install

# Build plugin
npm run build

# Development mode (auto-rebuild)
npm run dev
```

### Testing

```bash
# Type checking
npm run type-check

# Lint
npm run lint
```

### Project Structure

```
zeddal/
├── services/          # Core business logic
│   ├── RecorderService.ts
│   ├── WhisperService.ts
│   ├── LLMRefineService.ts
│   ├── VaultRAGService.ts
│   ├── MCPClientService.ts
│   └── ...
├── ui/               # User interface components
│   ├── RecordModal.ts
│   ├── StatusBar.ts
│   └── ...
├── utils/            # Utilities and types
│   ├── Types.ts
│   ├── Config.ts
│   └── ...
├── main.ts          # Plugin entry point
└── styles.css       # UI styling
```

---

## Support

### Getting Help
- **Issues**: [GitHub Issues](https://github.com/jashutch/zeddal/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jashutch/zeddal/discussions)
- **Documentation**: [Full Docs](https://github.com/jashutch/zeddal/wiki)

### Contributing
Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Roadmap

### Planned Features
- [ ] Custom prompt templates for refinement
- [ ] Speaker diarization for multi-person recordings
- [ ] Offline transcription (local Whisper models)
- [ ] Custom LLM provider support (Anthropic, local models)
- [ ] Audio annotation and timestamping
- [ ] Batch processing for multiple recordings
- [ ] Mobile app support (when Obsidian API allows)

### Under Consideration
- Integration with other note-taking workflows
- Voice command system for hands-free operation
- Advanced audio editing capabilities
- Collaborative transcription review

---

## License

MIT License - see [LICENSE](LICENSE) file for details

---

## Acknowledgments

- **OpenAI**: Whisper and GPT-4 APIs
- **Obsidian**: Powerful knowledge base platform
- **MCP**: Model Context Protocol specification
- **Community**: Beta testers and contributors

---

## About

Zeddal was created to bridge the gap between spoken thoughts and written notes, making knowledge capture as natural as conversation while leveraging the full power of AI and your existing knowledge base.

Built with ❤️ for the Obsidian community.
