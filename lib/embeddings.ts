import { logger } from '@/lib/logger';

/**
 * Generates a text embedding vector using Google Gemini Embedding API.
 *
 * Env vars:
 *   GEMINI_API_KEY  — Google AI Studio API key (same one used for chat)
 *
 * Uses outputDimensionality=1536 so vectors are compatible with the existing
 * Supabase HNSW index (pgvector has a hard limit of 2000 dimensions for HNSW).
 * The full Gemini model produces 3072D but we truncate to 1536D here.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-exp-03-07';
const GEMINI_EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;

/**
 * Embed a single text string using Gemini Embedding API.
 * Returns a number[] of 1536 dimensions (compatible with Supabase vector(1536) + HNSW).
 *
 * Throws a descriptive error if the API key is missing — callers should
 * catch it and degrade gracefully (the catalog tools do not depend on this).
 */
export async function embedText(text: string): Promise<number[]> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY no configurada. La base de conocimiento documental no esta disponible; usa searchCatalog/getProductPrice para el catalogo.'
    );
  }

  const res = await fetch(GEMINI_EMBED_URL, {
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
    logger.error('Gemini Embedding API error', { status: res.status, body: errText });
    throw new Error(`Gemini Embedding API returned ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { embedding?: { values: number[] } };
  const embedding = data?.embedding?.values;

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Gemini Embedding API returned no embedding data');
  }

  return embedding;
}
