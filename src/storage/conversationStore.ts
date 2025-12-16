import { Preferences } from '@capacitor/preferences';
import { logger } from '@/utils/logger';

const CONVERSATION_STORAGE_KEY = 'conversation_history';
const MAX_CONVERSATION_TURNS = 12;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}


export async function getConversationHistory(): Promise<ConversationMessage[]> {
  try {
    const { value } = await Preferences.get({ key: CONVERSATION_STORAGE_KEY });

    if (!value) {
      return [];
    }

    const messages: ConversationMessage[] = JSON.parse(value);


    return messages.filter((msg) =>
      msg &&
      (msg.role === 'user' || msg.role === 'assistant') &&
      typeof msg.text === 'string' &&
      typeof msg.timestamp === 'number'
    );
  } catch (error) {
    logger.error('Error reading conversation history', 'Storage', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}


export async function appendMessage(message: ConversationMessage): Promise<void> {
  try {
    const history = await getConversationHistory();

    // Add new message
    history.push({
      role: message.role,
      text: message.text.trim(),
      timestamp: message.timestamp || Date.now(),
    });


    const limitedHistory = history.slice(-MAX_CONVERSATION_TURNS);


    await Preferences.set({
      key: CONVERSATION_STORAGE_KEY,
      value: JSON.stringify(limitedHistory),
    });

    logger.debug(`Saved ${message.role} message. Total turns: ${limitedHistory.length}`, 'Storage');
  } catch (error) {
    logger.error('Error saving message', 'Storage', error instanceof Error ? error : new Error(String(error)));
  }
}


export async function getLastTurns(limit: number = MAX_CONVERSATION_TURNS): Promise<ConversationMessage[]> {
  const history = await getConversationHistory();
  return history.slice(-limit);
}

export async function clearConversationHistory(): Promise<void> {
  try {
    await Preferences.remove({ key: CONVERSATION_STORAGE_KEY });
    logger.debug('Conversation history cleared', 'Storage');
  } catch (error) {
    logger.error('Error clearing history', 'Storage', error instanceof Error ? error : new Error(String(error)));
  }
}


export async function formatConversationContext(): Promise<string> {
  const messages = await getLastTurns(MAX_CONVERSATION_TURNS);

  if (messages.length === 0) {
    logger.debug('No conversation history to format', 'Storage');
    return '';
  }

  const formatted = messages.map((msg) => {
    const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
    return `${roleLabel}: ${msg.text}`;
  }).join('\n\n');

  logger.debug(`Formatted context from ${messages.length} messages (${formatted.length} chars)`, 'Storage');
  return formatted;
}


export async function getConversationContextArray(): Promise<Array<{ role: string; content: string }>> {
  const messages = await getLastTurns(MAX_CONVERSATION_TURNS);

  return messages.map((msg) => ({
    role: msg.role,
    content: msg.text,
  }));
}

