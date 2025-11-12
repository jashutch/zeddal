# Enhanced Note-Taking with [[Zeddal]]'s Retrieval-Augmented Generation Feature

## Overview of Retrieval-Augmented Generation (RAG)
[[Zeddal]]'s Retrieval-Augmented Generation (RAG) feature is designed to personalize AI-assisted transcription. It ensures that the output matches your unique tone, structure, and vocabulary, diverging from generic AI-generated text. This customization is achieved through a sophisticated indexing and embedding process that reflects your specific writing style.

## How RAG Works
1. **Indexing Your Vault:**
   - Upon enabling RAG, [[Zeddal]] automatically begins indexing your vault.
   - All markdown files are segmented into 500-token chunks.
   - Each chunk is then embedded to create a unique numerical footprint that captures its specific meaning and writing style.

1. **Building a Searchable Memory:**
   - The system constructs a searchable memory from these embeddings.
   - It maintains an up-to-date index that adjusts as you edit or add new notes.

3. **Refining Voice Notes:**
   - When you record a voice note, [[Zeddal]] identifies the three most relevant passages from your vault based on the topic and style.
   - These passages are supplied to GPT-4 as context.
   - The resulting note is refined to blend seamlessly with your existing writing, maintaining the continuity and individuality of your notes.

## Support for Various Environments
- [[Zeddal]] RAG supports both OpenAI cloud embeddings and local or air-gap servers, catering to different security needs and environments.

## Functionality Without RAG
- In instances where RAG is disabled or temporarily unavailable, [[Zeddal]] continues to refine notes. However, these refinements occur without the personalized touch derived from your vault’s indexed content.

By utilizing [[Zeddal]]'s RAG feature, users can significantly enhance the personalization and relevance of their transcribed notes, making them more consistent with their existing content and style preferences.

> Transcription meta
> Speaking: 403.25s
> Recorded: 66.90s