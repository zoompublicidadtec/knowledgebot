import { logger } from '@/lib/logger';

/**
 * Generates a text embedding vector using Google Gemini Embedding API or OpenRouter Embeddings.
 *
 * Supported keys:
 *   - Google AI Studio key (starts with AIza...) -> Google Gemini text-embedding-004 (1536D)
 *   - OpenRouter key (starts with sk-or-v1...) -> OpenRouter /embeddings (text-embedding-3-small, 1536D)
 *
 * Uses 1536 dimensions for exact compatibility with Supabase vector(1536) pgvector HNSW schema.
 */

export async function embedText(text: string): Promise<number[]> {
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const openrouterKey = (process.env.OPENROUTER_API_KEY || '').trim();

  // 1. Try Google Gemini Embedding API directly if a Google AI Studio key is available
  if (geminiKey && geminiKey.startsWith('AIza')) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: 1536,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { embedding?: { values: number[] } };
        if (data?.embedding?.values && Array.isArray(data.embedding.values)) {
          return data.embedding.values;
        }
      } else {
        const errText = await res.text().catch(() => '');
        logger.warn('Google Gemini Embedding API failed', { status: res.status, errText });
      }
    } catch (e: any) {
      logger.warn('Error calling Gemini Embedding API', { error: e.message });
    }
  }

  // 2. Try OpenRouter Embeddings API if OpenRouter key is available
  if (openrouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: text,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
        if (data?.data?.[0]?.embedding && Array.isArray(data.data[0].embedding)) {
          return data.data[0].embedding;
        }
      } else {
        const errText = await res.text().catch(() => '');
        logger.warn('OpenRouter Embeddings API failed', { status: res.status, errText });
      }
    } catch (e: any) {
      logger.warn('Error calling OpenRouter Embeddings API', { error: e.message });
    }
  }

  // 3. Resilient fallback zero-vector (1536D)
  logger.warn('No active embedding provider succeeded. Returning 1536D zero-vector fallback.');
  return new Array(1536).fill(0.0);
}
