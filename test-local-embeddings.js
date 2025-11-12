// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * Test script for local embedding servers
 * Usage: node test-local-embeddings.js <url> <model>
 * Example: node test-local-embeddings.js http://localhost:11434/api/embeddings nomic-embed-text
 */

const url = process.argv[2] || 'http://localhost:11434/api/embeddings';
const model = process.argv[3] || 'nomic-embed-text';

console.log(`🧪 Testing local embedding server...`);
console.log(`📍 URL: ${url}`);
console.log(`🤖 Model: ${model}`);
console.log('');

async function testEmbeddings() {
  const testTexts = [
    "This is a test sentence for embedding.",
    "Another test sentence with different content."
  ];

  try {
    console.log(`📤 Sending ${testTexts.length} texts for embedding...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: testTexts,
        model: model
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Success!');
    console.log('');
    console.log(`📊 Results:`);
    console.log(`  - Embeddings received: ${data.data.length}`);
    console.log(`  - Dimensions: ${data.data[0].embedding.length}`);
    console.log(`  - Model: ${data.model || model}`);

    if (data.usage) {
      console.log(`  - Tokens used: ${data.usage.total_tokens}`);
    }

    console.log('');
    console.log(`🎉 Your local embedding server is working correctly!`);
    console.log('');
    console.log(`📝 Configure Zeddal with:`);
    console.log(`  - Custom Embedding URL: ${url}`);
    console.log(`  - Embedding Model: ${model}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('');
    console.log('💡 Troubleshooting:');
    console.log('  1. Make sure your embedding server is running');
    console.log('  2. Check the URL is correct');
    console.log('  3. Verify the model name matches your server');
    console.log('  4. Check server logs for errors');
  }
}

testEmbeddings();
