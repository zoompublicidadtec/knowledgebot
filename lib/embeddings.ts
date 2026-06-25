import { logger } from '@/lib/logger';

/**
 * Generates a text embedding vector using the configured OpenAI-compatible API.
 *
 * Env vars:
 *   EMBEDDINGS_BASE_URL  — e.g. https://api.openai.com/v1
 *   EMBEDDINGS_API_KEY   — API key for the embeddings provider
 *   EMBEDDINGS_MODEL     — e.g. text-embedding-3-small (produces 1536d)
 */

const BASE_URL = (process.env.EMBEDDINGS_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_KEY = process.env.EMBEDDINGS_API_KEY || '';
const MODEL = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';

/**
 * Embed a single text string. Returns a number[] of the dimensionality
 * specified by the model (1536 for text-embedding-3-small).
 *
 * Throws a descriptive error if the API key is missing — callers should
 * catch it and degrade gracefully (the catalog tools do not depend on this).
 */
export async function embedText(text: string): Promise<number[]> {
  if (!API_KEY) {
    throw new Error(
      'EMBEDDINGS_API_KEY no configurada. La base de conocimiento documental no esta disponible; usa searchCatalog/getProductPrice para el catalogo.'
    );
  }

  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text, model: MODEL }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    logger.error('Embedding API error', { status: res.status, body: errText, model: MODEL });
    throw new Error(`Embedding API returned ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const embedding = data?.data?.[0]?.embedding;

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Embedding API returned no embedding data');
  }

  return embedding;
}
