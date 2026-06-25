import { logger } from '@/lib/logger';

interface TranscribeResult {
  text: string;
}

export async function transcribeAudio(
  base64Data: string,
  mimetype: string
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.error('OPENROUTER_API_KEY is not defined in environment variables');
    throw new Error('OPENROUTER_API_KEY missing');
  }

  // Determine file format from mimetype (e.g. "audio/ogg; codecs=opus")
  let format = 'ogg';
  const match = mimetype.match(/audio\/(\w+)/);
  if (match) {
    format = match[1];
  }

  // OpenRouter transcription endpoint
  const url = 'https://openrouter.ai/api/v1/audio/transcriptions';

  logger.info(`Sending audio transcription request to OpenRouter (format: ${format})...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/whisper-large-v3-turbo',
        // Send both camelCase and snake_case to be fully compliant with OpenRouter specs
        inputAudio: {
          data: base64Data,
          format: format,
        },
        input_audio: {
          data: base64Data,
          format: format,
        },
        language: 'es', // Request Spanish transcription
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('OpenRouter transcription error response', {
        status: response.status,
        body: errText,
      });
      throw new Error(`OpenRouter transcription returned status ${response.status}`);
    }

    const data = (await response.json()) as TranscribeResult;
    const transcribedText = data.text?.trim() || '';

    logger.info('Successfully transcribed audio', { length: transcribedText.length });
    return transcribedText;
  } catch (err) {
    logger.error('Failed to transcribe audio via OpenRouter', { error: String(err) });
    throw err;
  }
}
