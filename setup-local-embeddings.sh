#!/bin/bash

# Setup script for local embeddings with Ollama
# This script installs and configures Ollama for use with Zeddal

set -e

echo "🚀 Zeddal Local Embeddings Setup"
echo "================================="
echo ""

# Check if Ollama is installed
if command -v ollama &> /dev/null; then
    echo "✅ Ollama is already installed"
else
    echo "📦 Installing Ollama..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install ollama
        else
            curl -fsSL https://ollama.com/install.sh | sh
        fi
    else
        # Linux
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    echo "✅ Ollama installed"
fi

echo ""
echo "📥 Pulling embedding model (nomic-embed-text)..."
echo "   This may take a few minutes on first run..."
ollama pull nomic-embed-text

echo ""
echo "🔧 Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!
echo "   Server PID: $OLLAMA_PID"

# Wait for server to start
sleep 3

echo ""
echo "🧪 Testing embeddings..."
node test-local-embeddings.js http://localhost:11434/api/embeddings nomic-embed-text

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Open Obsidian Settings → Zeddal → RAG Settings"
echo "   2. Enable RAG"
echo "   3. Set Custom embedding endpoint to: http://localhost:11434/api/embeddings"
echo "   4. Leave the field blank or set model to: nomic-embed-text"
echo "   5. Click 'Rebuild Index' to generate embeddings"
echo ""
echo "💡 To keep Ollama running in background:"
echo "   pkill -P $OLLAMA_PID"
echo "   ollama serve &"
