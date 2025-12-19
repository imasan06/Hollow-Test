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


// Lock to prevent concurrent writes
let isWriting = false;
const writeQueue: Array<() => Promise<void>> = [];

async function processWriteQueue(): Promise<void> {
  if (isWriting || writeQueue.length === 0) {
    return;
  }

  isWriting = true;
  while (writeQueue.length > 0) {
    const writeFn = writeQueue.shift();
    if (writeFn) {
      try {
        await writeFn();
      } catch (error) {
        logger.error('Error in write queue', 'Storage', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  isWriting = false;
}

export async function appendMessage(message: ConversationMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    writeQueue.push(async () => {
      try {
        const history = await getConversationHistory();

        const newMessage = {
          role: message.role,
          text: message.text.trim(),
          timestamp: message.timestamp || Date.now(),
        };

        // Check for duplicates by timestamp
        const isDuplicate = history.some(
          (msg) => msg.timestamp === newMessage.timestamp && msg.role === newMessage.role
        );

        if (isDuplicate) {
          logger.debug(`Skipping duplicate message with timestamp ${newMessage.timestamp}`, 'Storage');
          resolve();
          return;
        }

        history.push(newMessage);

        const limitedHistory = history.slice(-MAX_CONVERSATION_TURNS);

        await Preferences.set({
          key: CONVERSATION_STORAGE_KEY,
          value: JSON.stringify(limitedHistory),
        });

        logger.debug(`Saved ${message.role} message: "${newMessage.text.substring(0, 50)}...". Total turns: ${limitedHistory.length}`, 'Storage');
        resolve();
      } catch (error) {
        logger.error('Error saving message', 'Storage', error instanceof Error ? error : new Error(String(error)));
        reject(error);
      }
    });

    processWriteQueue();
  });
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

export async function deleteMessage(timestamp: number): Promise<boolean> {
  try {
    const history = await getConversationHistory();
    const filtered = history.filter((msg) => msg.timestamp !== timestamp);
    
    if (filtered.length === history.length) {
      logger.warn('Message not found for deletion', 'Storage');
      return false;
    }
    
    await Preferences.set({
      key: CONVERSATION_STORAGE_KEY,
      value: JSON.stringify(filtered),
    });
    
    logger.debug(`Deleted message with timestamp ${timestamp}. Remaining messages: ${filtered.length}`, 'Storage');
    return true;
  } catch (error) {
    logger.error('Error deleting message', 'Storage', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}


export async function formatConversationContext(excludeLastUserMessage?: boolean): Promise<string> {
  const allMessages = await getLastTurns(MAX_CONVERSATION_TURNS);

  if (allMessages.length === 0) {
    // Only log in dev mode
    if (import.meta.env.DEV) {
      logger.debug('No conversation history to format', 'Storage');
    }
    return '';
  }

  const sortedMessages = allMessages.sort((a, b) => a.timestamp - b.timestamp);
  
  // If excludeLastUserMessage is true, remove the last user message to avoid duplication
  let messagesToFormat = sortedMessages;
  if (excludeLastUserMessage && sortedMessages.length > 0) {
    const lastMessage = sortedMessages[sortedMessages.length - 1];
    if (lastMessage.role === 'user') {
      messagesToFormat = sortedMessages.slice(0, -1);
      // Only log in dev mode
      if (import.meta.env.DEV) {
        logger.debug(`Excluding last user message from context to avoid duplication`, 'Storage');
      }
    }
  }
  
  const last12Pairs = messagesToFormat.slice(-24);

  const formatted = last12Pairs.map((msg) => {
    const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
    return `${roleLabel}: ${msg.text}`;
  }).join('\n\n');

  // Only log detailed context info in development mode for performance
  if (import.meta.env.DEV) {
    logger.debug(`Formatting context from ${allMessages.length} total messages, taking last ${last12Pairs.length} messages`, 'Storage');
    logger.debug(`Formatted context: ${last12Pairs.length} messages (last 12 conversation pairs), ${formatted.length} chars`, 'Storage');
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

