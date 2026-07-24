import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { logger } from '@/lib/logger';

const openrouter = createOpenAICompatible({
  name: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

const model = openrouter.chatModel(process.env.CHAT_MODEL || 'google/gemini-2.5-flash');

export async function describeImage(base64Data: string, mimetype: string): Promise<string> {
  try {
    logger.info('Solicitando descripción de imagen a Gemini en OpenRouter...');
    
    const result = await generateText({
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: 'Describe esta imagen de forma breve y precisa (máximo 2 párrafos). Enfócate en identificar qué tipo de producto es (por ejemplo: un termo/botilito, llavero, gorra, camiseta, libreta, lapicero, etc.), su material, color y si tiene algún texto o logotipo impreso. Esta descripción se usará para dar contexto a una IA de ventas.' 
            },
            {
              type: 'image',
              image: Buffer.from(base64Data, 'base64'),
              mediaType: mimetype as any,
            },
          ],
        },
      ],
    });

    const description = result.text?.trim() || '';
    logger.info('Descripción de imagen generada con éxito', { length: description.length });
    return description;
  } catch (err) {
    logger.error('Error al describir la imagen con Gemini:', { error: String(err) });
    throw err;
  }
}
