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

  const models = [
    'openai/whisper-large-v3-turbo',
    'openai/whisper-large-v3',
    'openai/whisper-1',
  ];

  let lastError: any = null;

  for (const model of models) {
    logger.info(`Sending audio transcription request to OpenRouter using ${model} (format: ${format})...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          input_audio: {
            data: base64Data,
            format: format,
          },
          language: 'es',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.warn(`OpenRouter transcription error with model ${model}`, {
          status: response.status,
          body: errText,
        });
        lastError = new Error(`OpenRouter transcription returned status ${response.status}: ${errText}`);
        continue;
      }

      const data = (await response.json()) as TranscribeResult;
      const transcribedText = data.text?.trim() || '';

      logger.info(`Successfully transcribed audio using ${model}`, { length: transcribedText.length });
      return transcribedText;
    } catch (err: any) {
      logger.warn(`Failed to transcribe audio using ${model}`, { error: String(err) });
      lastError = err;
    }
  }

  logger.error('All transcription models failed', { error: String(lastError) });
  throw lastError || new Error('Transcription failed');
}
