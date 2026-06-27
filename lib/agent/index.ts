import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildSystemPrompt } from './system-prompt';
import { isRealColombianName } from './colombian-names';
import { getAvailableSlotsTool } from './tools/get-available-slots';
import { bookAppointmentTool } from './tools/book-appointment';
import { cancelAppointmentTool } from './tools/cancel-appointment';
import { rescheduleAppointmentTool } from './tools/reschedule-appointment';
import { queryKnowledgeBaseTool } from './tools/query-knowledge-base';
import { searchCatalogTool } from './tools/search-catalog';
import { getProductPriceTool } from './tools/get-product-price';
import { saveContactInfoTool } from './tools/save-contact-info';
import { requestHumanHandoffTool } from './tools/request-human-handoff';
import { calculateCustomPriceTool } from './tools/calculate-custom-price';
import { logger } from '@/lib/logger';
import type { AgentConfig } from '@/lib/database.types';

const openrouter = createOpenAICompatible({
  name: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

// DeepSeek Chat is provided through OpenRouter for the conversational layer.
const model = openrouter.chatModel(process.env.CHAT_MODEL || 'google/gemini-2.5-flash');

/**
 * Removes consecutive duplicate assistant messages from the conversation history.
 * OpenRouter's loop detection triggers when it sees near-identical assistant
 * responses in sequence (common when the bot repeats similar info).
 */
function deduplicateHistory(messages: { role: string; content: string }[]) {
  return messages.filter((msg, idx) => {
    if (idx === 0) return true;
    const prev = messages[idx - 1];
    if (
      msg.role === 'assistant' &&
      prev.role === 'assistant' &&
      msg.content.trim() === prev.content.trim()
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Runs the AI agent for an inbound WhatsApp message.
 * Returns the agent's text response or null if no response.
 */
export async function runAgentForMessage(params: {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
  messageText: string;
  agentConfig: AgentConfig;
}): Promise<string | null> {
  const { orgId, contactPhone, contactName, conversationId, messageText, agentConfig } = params;

  try {
    const supabase = createAdminClient();

    // Load last 10 messages only — reduces loop detection risk from long histories
    const { data: history } = await (supabase as any)
      .from('messages')
      .select('direction, sender, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);

    const rawMessages: { role: string; content: string }[] = [];

    if (history) {
      const chronologicalHistory = [...history].reverse();
      for (const msg of chronologicalHistory) {
        if (!msg.content) continue;
        rawMessages.push({
          role: msg.direction === 'inbound' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current message if not already the last one in history
    const lastMsg = rawMessages[rawMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== messageText) {
      rawMessages.push({ role: 'user', content: messageText });
    }

    // Deduplicate consecutive identical assistant messages
    const messages = deduplicateHistory(rawMessages);

    // Get organization timezone and contact metadata
    const [orgResult, contactResult] = await Promise.all([
      (supabase as any)
        .from('organizations')
        .select('timezone')
        .eq('id', orgId)
        .single(),
      (supabase as any)
        .from('contacts')
        .select('metadata')
        .eq('organization_id', orgId)
        .eq('wa_phone', contactPhone)
        .single(),
    ]);

    const timeZone = orgResult.data?.timezone || 'America/Bogota';
    const contactMetadata = contactResult.data?.metadata || {};

    // Detect trigger 'oscar' (case-insensitive) in current message or recent history
    const hasOscarTrigger = messageText.toLowerCase().includes('oscar') ||
      messages.some(m => m.role === 'user' && m.content.toLowerCase().includes('oscar'));

    // Check if the contact name is a valid Colombian name
    const isValidColombianName = contactName ? isRealColombianName(contactName) : false;

    const systemPrompt = buildSystemPrompt(
      agentConfig,
      contactName,
      contactPhone,
      timeZone,
      contactMetadata,
      hasOscarTrigger,
      isValidColombianName
    );

    const toolContext = { orgId, contactPhone, contactName, conversationId };

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: {
        getAvailableSlots: getAvailableSlotsTool(toolContext),
        bookAppointment: bookAppointmentTool(toolContext),
        cancelAppointment: cancelAppointmentTool(toolContext),
        rescheduleAppointment: rescheduleAppointmentTool(toolContext),
        searchCatalog: searchCatalogTool(),
        getProductPrice: getProductPriceTool(),
        saveContactInfo: saveContactInfoTool(toolContext),
        queryKnowledgeBase: queryKnowledgeBaseTool(toolContext),
        requestHumanHandoff: requestHumanHandoffTool(toolContext),
        calculateCustomPrice: calculateCustomPriceTool(),
      },
      stopWhen: stepCountIs(10),
      maxSteps: 10,
      temperature: 0.4,
    } as any);

    logger.info('Agent finished', { orgId, conversationId, steps: result.steps?.length || 0 });

    const responseText = result.text;
    if (!responseText?.trim()) {
      logger.warn('Agent returned empty response', { orgId, conversationId });
      return null;
    }

    return responseText;
  } catch (err) {
    logger.error('Agent error', {
      error: String(err),
      orgId,
      conversationId,
    });
    return 'Lo siento, estoy teniendo problemas técnicos. Un momento por favor, te paso con un humano.';
  }
}
