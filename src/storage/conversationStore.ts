import { Preferences } from '@capacitor/preferences';
import { logger } from '@/utils/logger';

const CONVERSATION_STORAGE_KEY = 'conversation_history';
const MAX_CONVERSATION_TURNS = 24;

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

    const filtered = messages.filter((msg) =>
      msg &&
      (msg.role === 'user' || msg.role === 'assistant') &&
      typeof msg.text === 'string' &&
      typeof msg.timestamp === 'number'
    );

    const sorted = filtered.sort((a, b) => a.timestamp - b.timestamp);

    return sorted;
  } catch (error) {
    logger.error('Error reading conversation history', 'Storage', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}


export async function appendMessage(message: ConversationMessage): Promise<void> {
  try {
    const history = await getConversationHistory();

    const newMessage = {
      role: message.role,
      text: message.text.trim(),
      timestamp: message.timestamp || Date.now(),
    };

    history.push(newMessage);

    const limitedHistory = history.slice(-MAX_CONVERSATION_TURNS);

    await Preferences.set({
      key: CONVERSATION_STORAGE_KEY,
      value: JSON.stringify(limitedHistory),
    });

    logger.debug(`Saved ${message.role} message: "${newMessage.text.substring(0, 50)}...". Total turns: ${limitedHistory.length}`, 'Storage');

    const verifyHistory = await getConversationHistory();
    const lastMessage = verifyHistory[verifyHistory.length - 1];
    if (lastMessage && lastMessage.text === newMessage.text && lastMessage.role === newMessage.role) {
      logger.debug('Message verified in storage', 'Storage');
    } else {
      logger.warn('Message verification failed - message may not be saved correctly', 'Storage');
    }
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
  const allMessages = await getLastTurns(MAX_CONVERSATION_TURNS);

  if (allMessages.length === 0) {
    logger.debug('No conversation history to format', 'Storage');
    return '';
  }

  const sortedMessages = allMessages.sort((a, b) => a.timestamp - b.timestamp);
  const last12Pairs = sortedMessages.slice(-24);
  
  logger.debug(`Formatting context from ${allMessages.length} total messages, taking last ${last12Pairs.length} messages`, 'Storage');

  if (last12Pairs.length > 0) {
    const lastMessage = last12Pairs[last12Pairs.length - 1];
    logger.debug(`Last message in context: ${lastMessage.role} - "${lastMessage.text.substring(0, 50)}..." (timestamp: ${lastMessage.timestamp})`, 'Storage');
  }

  const formatted = last12Pairs.map((msg) => {
    const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
    return `${roleLabel}: ${msg.text}`;
  }).join('\n\n');

  logger.debug(`Formatted context: ${last12Pairs.length} messages (last 12 conversation pairs), ${formatted.length} chars`, 'Storage');
  
  if (formatted.length > 0) {
    const preview = formatted.substring(0, 200);
    logger.debug(`Context preview (first 200 chars): ${preview}...`, 'Storage');
    const lastPart = formatted.substring(Math.max(0, formatted.length - 200));
    logger.debug(`Context preview (last 200 chars): ...${lastPart}`, 'Storage');
  }

  return formatted;
}


export async function getConversationContextArray(): Promise<Array<{ role: string; content: string }>> {
  const messages = await getLastTurns(MAX_CONVERSATION_TURNS);

  return messages.map((msg) => ({
    role: msg.role,
    content: msg.text,
  }));
}

