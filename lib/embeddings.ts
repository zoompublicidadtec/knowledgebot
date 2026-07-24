import { logger } from '@/lib/logger';

/**
 * Generates a text embedding vector using Google Gemini Embedding API.
 *
 * Env vars:
 *   GEMINI_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY
 *
 * Uses outputDimensionality=1536 so vectors are compatible with Supabase vector(1536)
 * (pgvector has a hard limit of 2000 dimensions for HNSW).
 */

function getApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    ''
  ).trim();
}

const GEMINI_EMBEDDING_MODEL = 'text-embedding-004';

/**
 * Embed a single text string using Gemini Embedding API (text-embedding-004).
 * Returns a number[] of 1536 dimensions (compatible with Supabase vector(1536) + HNSW).
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = getApiKey();

  if (!apiKey) {
    logger.warn('No Gemini/Google API key found. Using fallback zero vector for glossary item.');
    return new Array(1536).fill(0.0);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `models/${GEMINI_EMBEDDING_MODEL}`,
        content: {
          parts: [{ text }],
        },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 1536,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.warn('Gemini Embedding API call failed, using fallback vector', { status: res.status, body: errText });
      return new Array(1536).fill(0.0);
    }

    const data = (await res.json()) as { embedding?: { values: number[] } };
    const embedding = data?.embedding?.values;

    if (!embedding || !Array.isArray(embedding)) {
      logger.warn('Gemini Embedding API returned no values, using fallback vector');
      return new Array(1536).fill(0.0);
    }

    return embedding;
  } catch (err: any) {
    logger.warn('Error in embedText, using fallback zero vector', { error: err.message });
    return new Array(1536).fill(0.0);
  }
}
