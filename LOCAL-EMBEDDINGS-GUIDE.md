# Local Embeddings Testing Guide

This guide walks you through setting up and testing local embeddings with Zeddal.

## Why Use Local Embeddings?

- **Privacy**: No data sent to OpenAI for embedding generation
- **Cost**: Zero API costs after initial setup
- **Speed**: Often faster than API calls
- **Offline**: Works without internet connection
- **Compliance**: Required for air-gapped or secure environments (DOD/DOJ)

## Quick Start (5 minutes)

### Option 1: Automated Setup with Ollama

```bash
cd /Users/jasonhutchcraft/Desktop/Zeddal
chmod +x setup-local-embeddings.sh
./setup-local-embeddings.sh
```

Then configure Obsidian:
1. Open **Settings → Zeddal → RAG Settings**
2. Toggle **Enable RAG** ON
3. Set **Custom embedding endpoint** to: `http://localhost:11434/api/embeddings`
4. Click **Rebuild Index**

### Option 2: Manual Setup

#### Step 1: Install and Start Embedding Server

**Using Ollama (Recommended):**
```bash
# Install Ollama
brew install ollama  # macOS with Homebrew
# OR
curl -fsSL https://ollama.com/install.sh | sh  # macOS/Linux

# Pull an embedding model
ollama pull nomic-embed-text

# Start server (runs on http://localhost:11434)
ollama serve
```

**Using Docker (text-embeddings-inference):**
```bash
docker run -d -p 8080:80 \
  -v $PWD/data:/data \
  ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-small-en-v1.5
```

**Using Python (sentence-transformers):**
```bash
pip install fastapi uvicorn sentence-transformers
python embedding_server.py  # See Python example below
```

#### Step 2: Test the Server

```bash
cd /Users/jasonhutchcraft/Desktop/Zeddal
node test-local-embeddings.js [url] [model]
```

Examples:
```bash
# Ollama
node test-local-embeddings.js http://localhost:11434/api/embeddings nomic-embed-text

# Docker TEI
node test-local-embeddings.js http://localhost:8080/embed BAAI/bge-small-en-v1.5

# Python server
node test-local-embeddings.js http://localhost:8000/embeddings all-MiniLM-L6-v2
```

You should see:
```
✅ Success!
📊 Results:
  - Embeddings received: 2
  - Dimensions: 768
  - Model: nomic-embed-text
```

#### Step 3: Configure Zeddal

1. Open Obsidian
2. Go to **Settings → Zeddal**
3. Scroll to **RAG Settings (Retrieval-Augmented Generation)**
4. Toggle **Enable RAG** ON
5. In **Custom embedding endpoint**, enter your server URL:
   - Ollama: `http://localhost:11434/api/embeddings`
   - Docker TEI: `http://localhost:8080/embed`
   - Python: `http://localhost:8000/embeddings`
6. Set **Context chunks** to 3 (or adjust as needed)
7. Click **Rebuild Index** button
8. Wait for indexing to complete (check console for progress)

#### Step 4: Test in Zeddal

1. Click the microphone icon in Obsidian
2. Record a voice note that mentions topics in your vault
3. Stop recording
4. Watch the console - you should see:
   ```
   RAG retrieved X contexts in Yms
   ```
5. The refined transcription should incorporate context from your vault

## Embedding Models Comparison

| Model | Size | Dimensions | Speed | Quality | Best For |
|-------|------|------------|-------|---------|----------|
| nomic-embed-text | 274 MB | 768 | ⚡⚡⚡ | ⭐⭐⭐⭐ | General use, good balance |
| all-MiniLM-L6-v2 | 80 MB | 384 | ⚡⚡⚡⚡ | ⭐⭐⭐ | Speed, low memory |
| BAAI/bge-small-en-v1.5 | 133 MB | 384 | ⚡⚡⚡ | ⭐⭐⭐⭐ | English only, efficient |
| BAAI/bge-base-en-v1.5 | 438 MB | 768 | ⚡⚡ | ⭐⭐⭐⭐⭐ | Best quality, English |
| mxbai-embed-large | 670 MB | 1024 | ⚡ | ⭐⭐⭐⭐⭐ | Maximum quality |

## API Format

Zeddal expects an OpenAI-compatible embedding API:

**Request:**
```json
POST /embeddings
Content-Type: application/json

{
  "input": ["text to embed", "another text"],
  "model": "model-name"
}
```

**Response:**
```json
{
  "data": [
    {
      "embedding": [0.123, -0.456, ...],
      "index": 0
    },
    {
      "embedding": [0.789, -0.012, ...],
      "index": 1
    }
  ],
  "model": "model-name",
  "usage": {
    "prompt_tokens": 42,
    "total_tokens": 42
  }
}
```

## Python Server Example

Save this as `embedding_server.py`:

```python
from fastapi import FastAPI
from sentence_transformers import SentenceTransformer
import uvicorn
from pydantic import BaseModel
from typing import List, Union

app = FastAPI()
model = SentenceTransformer('all-MiniLM-L6-v2')

class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: str = "all-MiniLM-L6-v2"

@app.post("/embeddings")
async def create_embeddings(request: EmbeddingRequest):
    # Normalize input to list
    texts = request.input if isinstance(request.input, list) else [request.input]

    # Generate embeddings
    embeddings = model.encode(texts)

    # Format response
    return {
        "data": [
            {
                "embedding": emb.tolist(),
                "index": idx
            }
            for idx, emb in enumerate(embeddings)
        ],
        "model": request.model,
        "usage": {
            "prompt_tokens": sum(len(t.split()) for t in texts),
            "total_tokens": sum(len(t.split()) for t in texts)
        }
    }

@app.get("/health")
async def health():
    return {"status": "healthy", "model": "all-MiniLM-L6-v2"}

if __name__ == "__main__":
    print("🚀 Starting embedding server on http://localhost:8000")
    print("📊 Model: all-MiniLM-L6-v2 (384 dimensions)")
    print("📝 API endpoint: http://localhost:8000/embeddings")
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Run it:
```bash
pip install fastapi uvicorn sentence-transformers
python embedding_server.py
```

## Troubleshooting

### Server not responding

**Check if server is running:**
```bash
# Ollama
curl http://localhost:11434/api/tags

# Docker TEI
curl http://localhost:8080/health

# Python
curl http://localhost:8000/health
```

**Check ports:**
```bash
lsof -i :11434  # Ollama
lsof -i :8080   # Docker
lsof -i :8000   # Python
```

### Embeddings not being used

**Check Obsidian console:**
1. Open Obsidian Developer Tools (Cmd+Option+I on Mac)
2. Look for these messages:
   - `Building RAG index from scratch...`
   - `RAG index built: X chunks from Y files`
   - `RAG retrieved X contexts in Yms`

**Force rebuild:**
1. Settings → Zeddal → RAG Settings
2. Click **Rebuild Index**
3. Watch console for progress

### Wrong dimensions

If you see dimension mismatches:
1. Check which model your server is actually using
2. Rebuild the index after changing models
3. Verify the test script shows correct dimensions

### Performance issues

**Index building is slow:**
- Expected: ~10-20 files/minute for local embeddings
- Use smaller models (all-MiniLM-L6-v2) for faster indexing
- Batch size is 10 files at a time (configurable in VaultRAGService.ts:84)

**Queries are slow:**
- Local embeddings should be <100ms per query
- Check if your embedding server has GPU acceleration
- Consider using smaller model if CPU-bound

## Cost Comparison

### OpenAI (text-embedding-3-small)
- **Cost**: $0.00002 per 1K tokens
- **1000 notes** (~500 words each): ~$0.13 one-time + queries
- **Monthly** (100 voice notes): ~$0.01

### Local Embeddings
- **Cost**: $0 (electricity only)
- **Hardware**: Runs on CPU, ~2GB RAM
- **Bandwidth**: Zero (everything local)

## Security Considerations

### OpenAI Embeddings
- ✅ Content sent to OpenAI API
- ✅ Data retention: 30 days
- ✅ Not used for training
- ❌ Requires internet
- ❌ Costs money

### Local Embeddings
- ✅ No data leaves your machine
- ✅ Works offline
- ✅ Free forever
- ✅ Full control
- ⚠️ Requires local setup

## Next Steps

1. ✅ Set up local embedding server
2. ✅ Test with test-local-embeddings.js
3. ✅ Configure Zeddal settings
4. ✅ Rebuild RAG index
5. ✅ Test with voice recording
6. 📈 Monitor console for performance
7. 🎯 Adjust chunk size and top-K if needed

## Advanced Configuration

### Multiple Models

You can run multiple embedding servers on different ports:
```bash
# Terminal 1: Fast model for quick queries
ollama pull all-minilm
ollama serve --port 11434

# Terminal 2: High-quality model for important notes
ollama pull mxbai-embed-large
ollama serve --port 11435
```

Switch between them in Zeddal settings as needed.

### GPU Acceleration

**Ollama**: Automatically uses GPU if available (Metal on Mac, CUDA on Linux)

**Docker TEI**: Add GPU flags:
```bash
docker run --gpus all -p 8080:80 \
  ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-base-en-v1.5
```

**Python**: Install GPU-enabled PyTorch:
```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

## Support

If you encounter issues:
1. Check the test script output
2. Review Obsidian console logs
3. Verify server is running and accessible
4. Test with curl to isolate the issue
5. Report bugs with console logs at: https://github.com/jasonhutchcraft/zeddal/issues
