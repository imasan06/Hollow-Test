/**
 * Conversation History Storage
 * 
 * Manages persistent conversation history using Capacitor Preferences v7.
 * Stores user transcriptions and AI responses with timestamps.
 */

import { Preferences } from '@capacitor/preferences';

// Storage key for conversation history
const CONVERSATION_STORAGE_KEY = 'conversation_history';

// Maximum number of conversation turns to keep (12 turns = 6 user + 6 assistant)
const MAX_CONVERSATION_TURNS = 12;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number; // Date.now()
}

/**
 * Get all stored conversation messages
 */
export async function getConversationHistory(): Promise<ConversationMessage[]> {
  try {
    const { value } = await Preferences.get({ key: CONVERSATION_STORAGE_KEY });
    
    if (!value) {
      return [];
    }

    const messages: ConversationMessage[] = JSON.parse(value);
    
    // Validate and filter out invalid messages
    return messages.filter((msg) => 
      msg && 
      (msg.role === 'user' || msg.role === 'assistant') &&
      typeof msg.text === 'string' &&
      typeof msg.timestamp === 'number'
    );
  } catch (error) {
    console.error('[Storage] Error reading conversation history:', error);
    return [];
  }
}

/**
 * Append a new message to the conversation history
 * Automatically limits to MAX_CONVERSATION_TURNS
 */
export async function appendMessage(message: ConversationMessage): Promise<void> {
  try {
    const history = await getConversationHistory();
    
    // Add new message
    history.push({
      role: message.role,
      text: message.text.trim(),
      timestamp: message.timestamp || Date.now(),
    });

    // Keep only the last MAX_CONVERSATION_TURNS messages
    const limitedHistory = history.slice(-MAX_CONVERSATION_TURNS);

    // Save back to storage
    await Preferences.set({
      key: CONVERSATION_STORAGE_KEY,
      value: JSON.stringify(limitedHistory),
    });

    console.log(`[Storage] Saved ${message.role} message. Total turns: ${limitedHistory.length}`);
  } catch (error) {
    console.error('[Storage] Error saving message:', error);
    // Don't throw - we don't want to break the app if storage fails
  }
}

/**
 * Get the last N conversation turns (user + assistant combined)
 * Returns the most recent messages up to the limit
 */
export async function getLastTurns(limit: number = MAX_CONVERSATION_TURNS): Promise<ConversationMessage[]> {
  const history = await getConversationHistory();
  return history.slice(-limit);
}

/**
 * Clear all conversation history
 */
export async function clearConversationHistory(): Promise<void> {
  try {
    await Preferences.remove({ key: CONVERSATION_STORAGE_KEY });
    console.log('[Storage] Conversation history cleared');
  } catch (error) {
    console.error('[Storage] Error clearing history:', error);
  }
}

/**
 * Format conversation history as a context string for AI requests
 * Returns a formatted string: "USER: ... / ASSISTANT: ..."
 */
export async function formatConversationContext(): Promise<string> {
  const messages = await getLastTurns(MAX_CONVERSATION_TURNS);
  
  if (messages.length === 0) {
    console.log('[Storage] No conversation history to format');
    return '';
  }

  const formatted = messages.map((msg) => {
    const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
    return `${roleLabel}: ${msg.text}`;
  }).join('\n\n');

  console.log(`[Storage] Formatted context from ${messages.length} messages (${formatted.length} chars)`);
  return formatted;
}

/**
 * Format conversation history as an array of objects
 * Alternative format if backend prefers structured data
 */
export async function getConversationContextArray(): Promise<Array<{ role: string; content: string }>> {
  const messages = await getLastTurns(MAX_CONVERSATION_TURNS);
  
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.text,
  }));
}

