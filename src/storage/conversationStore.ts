import { Preferences } from '@capacitor/preferences';
import { logger } from '@/utils/logger';

const CONVERSATION_STORAGE_KEY = 'conversation_history';
const PERSISTENT_CONTEXT_KEY = 'persistent_context'; // Context that survives history clearing
const PERSISTENT_CONTEXT_PERSONA_KEY = 'persistent_context_persona_id'; // Track which persona this context belongs to
const MAX_CONVERSATION_TURNS = 24;
// OPTIMIZATION: Balance between context quality and API speed
// Increased to ensure important information is included in context
const MAX_CONTEXT_TURNS = 12; // Send last 12 messages (6 pairs) to API - ensures better context retention
const MAX_CONTEXT_CHARS = 4000; // Limit context to ~4000 chars - increased to preserve important information

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
        
        // Small delay to ensure storage write is fully persisted
        await new Promise(resolve => setTimeout(resolve, 50));
        
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
  return new Promise((resolve, reject) => {
    // Use write queue to prevent race conditions with concurrent writes
    writeQueue.push(async () => {
      try {
        // Only clear conversation history, NOT persistent context
        // Persistent context survives history clearing and only changes with persona
        await Preferences.remove({ key: CONVERSATION_STORAGE_KEY });
        logger.debug('Conversation history cleared (persistent context preserved)', 'Storage');
        resolve();
      } catch (error) {
        logger.error('Error clearing history', 'Storage', error instanceof Error ? error : new Error(String(error)));
        reject(error);
      }
    });
    
    processWriteQueue();
  });
}

export async function deleteMessage(timestamp: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // Use write queue to prevent race conditions with concurrent writes
    writeQueue.push(async () => {
      try {
        const history = await getConversationHistory();
        const filtered = history.filter((msg) => msg.timestamp !== timestamp);
        
        if (filtered.length === history.length) {
          logger.warn('Message not found for deletion', 'Storage');
          resolve(false);
          return;
        }
        
        await Preferences.set({
          key: CONVERSATION_STORAGE_KEY,
          value: JSON.stringify(filtered),
        });
        
        logger.debug(`Deleted message with timestamp ${timestamp}. Remaining messages: ${filtered.length}`, 'Storage');
        resolve(true);
      } catch (error) {
        logger.error('Error deleting message', 'Storage', error instanceof Error ? error : new Error(String(error)));
        reject(error);
      }
    });
    
    processWriteQueue();
  });
}


/**
 * Get persistent context that survives history clearing
 * This context is tied to the active persona and only changes when persona changes
 */
export async function getPersistentContext(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: PERSISTENT_CONTEXT_KEY });
    return value || '';
  } catch (error) {
    logger.error('Error reading persistent context', 'Storage', error instanceof Error ? error : new Error(String(error)));
    return '';
  }
}

/**
 * Update persistent context (called when important information is learned)
 * This context persists across history clearing
 */
export async function updatePersistentContext(contextText: string): Promise<void> {
  try {
    await Preferences.set({
      key: PERSISTENT_CONTEXT_KEY,
      value: contextText.trim(),
    });
    logger.debug(`Updated persistent context (${contextText.length} chars)`, 'Storage');
  } catch (error) {
    logger.error('Error updating persistent context', 'Storage', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Clear persistent context (called when persona changes)
 */
export async function clearPersistentContext(): Promise<void> {
  try {
    await Preferences.remove({ key: PERSISTENT_CONTEXT_KEY });
    await Preferences.remove({ key: PERSISTENT_CONTEXT_PERSONA_KEY });
    logger.debug('Persistent context cleared', 'Storage');
  } catch (error) {
    logger.error('Error clearing persistent context', 'Storage', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get the persona ID that the persistent context belongs to
 */
export async function getPersistentContextPersonaId(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: PERSISTENT_CONTEXT_PERSONA_KEY });
    return value || null;
  } catch (error) {
    logger.error('Error reading persistent context persona ID', 'Storage', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Set the persona ID for the persistent context
 */
export async function setPersistentContextPersonaId(personaId: string): Promise<void> {
  try {
    await Preferences.set({
      key: PERSISTENT_CONTEXT_PERSONA_KEY,
      value: personaId,
    });
    logger.debug(`Set persistent context persona ID: ${personaId}`, 'Storage');
  } catch (error) {
    logger.error('Error setting persistent context persona ID', 'Storage', error instanceof Error ? error : new Error(String(error)));
  }
}

export async function formatConversationContext(excludeLastUserMessage?: boolean): Promise<string> {
  // Start with persistent context (survives history clearing)
  const persistentContext = await getPersistentContext();
  const contextParts: string[] = [];
  
  if (persistentContext && persistentContext.trim().length > 0) {
    contextParts.push(persistentContext.trim());
  }

  // OPTIMIZATION: Only fetch what we need for context (not full history)
  const allMessages = await getLastTurns(MAX_CONTEXT_TURNS);

  if (allMessages.length > 0) {
    const sortedMessages = allMessages.sort((a, b) => a.timestamp - b.timestamp);
    
    // If excludeLastUserMessage is true, remove the last user message to avoid duplication
    let messagesToFormat = sortedMessages;
    if (excludeLastUserMessage && sortedMessages.length > 0) {
      const lastMessage = sortedMessages[sortedMessages.length - 1];
      if (lastMessage.role === 'user') {
        messagesToFormat = sortedMessages.slice(0, -1);
      }
    }
    
    // OPTIMIZATION: Take only last MAX_CONTEXT_TURNS messages for API
    const contextMessages = messagesToFormat.slice(-MAX_CONTEXT_TURNS);

    const formattedMessages = contextMessages.map((msg) => {
      const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
      return `${roleLabel}: ${msg.text}`;
    }).join('\n\n');

    if (formattedMessages.trim().length > 0) {
      contextParts.push(formattedMessages);
    }
  }

  let formatted = contextParts.join('\n\n');

  // OPTIMIZATION: Truncate context if too long (reduces API payload size)
  // But prioritize persistent context - only truncate message history if needed
  if (formatted.length > MAX_CONTEXT_CHARS) {
    if (persistentContext && persistentContext.length > MAX_CONTEXT_CHARS / 2) {
      // If persistent context is large, keep it and truncate messages
      const messagesPart = contextParts.length > 1 ? contextParts[1] : '';
      if (messagesPart) {
        const availableChars = MAX_CONTEXT_CHARS - persistentContext.length - 4; // -4 for '\n\n'
        if (availableChars > 100) {
          const truncateAt = messagesPart.lastIndexOf('\n\n', availableChars);
          if (truncateAt > availableChars / 2) {
            formatted = persistentContext + '\n\n' + messagesPart.substring(truncateAt + 2);
          } else {
            formatted = persistentContext + '\n\n' + messagesPart.substring(messagesPart.length - availableChars);
          }
        } else {
          formatted = persistentContext; // Keep only persistent context if too large
        }
      }
    } else {
      // Normal truncation
      const truncateAt = formatted.lastIndexOf('\n\n', MAX_CONTEXT_CHARS);
      if (truncateAt > MAX_CONTEXT_CHARS / 2) {
        formatted = formatted.substring(truncateAt + 2); // Keep more recent messages
      } else {
        formatted = formatted.substring(formatted.length - MAX_CONTEXT_CHARS);
      }
    }
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

