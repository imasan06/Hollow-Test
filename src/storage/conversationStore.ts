import { Preferences } from "@capacitor/preferences";
import { logger } from "@/utils/logger";

const CONVERSATION_STORAGE_KEY = "conversation_history";
const PERSISTENT_CONTEXT_KEY = "persistent_context";
const PERSISTENT_CONTEXT_PERSONA_KEY = "persistent_context_persona_id";

// Reduced limits for better performance
const MAX_CONVERSATION_TURNS = 20; // Reduced from 24
const MAX_CONTEXT_TURNS = 10; // Reduced from 12
const MAX_CONTEXT_CHARS = 3000; // Reduced from 4000

export interface ConversationMessage {
  role: "user" | "assistant";
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

    const filtered = messages.filter(
      (msg) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.text === "string" &&
        typeof msg.timestamp === "number"
    );

    const sorted = filtered.sort((a, b) => a.timestamp - b.timestamp);

    return sorted;
  } catch (error) {
    logger.error(
      "Error reading conversation history",
      "Storage",
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

let writeLock: Promise<void> = Promise.resolve();

export async function appendMessage(
  message: ConversationMessage
): Promise<void> {
  writeLock = writeLock.then(async () => {
    try {
      const history = await getConversationHistory();

      // Get the latest timestamp from history to ensure chronological order
      const latestTimestamp = history.length > 0 
        ? Math.max(...history.map(msg => msg.timestamp))
        : 0;

      // Ensure new message has a timestamp greater than the latest one
      // This guarantees chronological order: user message -> assistant response
      const baseTimestamp = message.timestamp || Date.now();
      const newTimestamp = baseTimestamp > latestTimestamp 
        ? baseTimestamp 
        : latestTimestamp + 1; // Add 1ms to ensure it's after the latest message

      const newMessage = {
        role: message.role,
        text: message.text.trim(),
        timestamp: newTimestamp,
      };

      const isDuplicate = history.some(
        (msg) =>
          msg.timestamp === newMessage.timestamp &&
          msg.role === newMessage.role &&
          msg.text === newMessage.text
      );

      if (isDuplicate) {
        logger.debug(
          `Skipping duplicate message with timestamp ${newMessage.timestamp}`,
          "Storage"
        );
        return;
      }

      history.push(newMessage);

      // Sort by timestamp to ensure chronological order
      history.sort((a, b) => a.timestamp - b.timestamp);

      const limitedHistory = history.slice(-MAX_CONVERSATION_TURNS);

      await Preferences.set({
        key: CONVERSATION_STORAGE_KEY,
        value: JSON.stringify(limitedHistory),
      });

      logger.debug(
        `Saved ${message.role} message: "${newMessage.text.substring(
          0,
          50
        )}..." at timestamp ${newMessage.timestamp}. Total turns: ${limitedHistory.length}`,
        "Storage"
      );
    } catch (error) {
      logger.error(
        "Error saving message",
        "Storage",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  });
  
  return writeLock;
}

export async function getLastTurns(
  limit: number = MAX_CONVERSATION_TURNS
): Promise<ConversationMessage[]> {
  const history = await getConversationHistory();
  return history.slice(-limit);
}

export async function clearConversationHistory(): Promise<void> {
  writeLock = writeLock.then(async () => {
    try {
      await Preferences.remove({ key: CONVERSATION_STORAGE_KEY });
      logger.debug(
        "Conversation history cleared (persistent context preserved)",
        "Storage"
      );
    } catch (error) {
      logger.error(
        "Error clearing history",
        "Storage",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  });
  
  return writeLock;
}

export async function deleteMessage(timestamp: number): Promise<boolean> {
  return writeLock.then(async () => {
    try {
      const history = await getConversationHistory();
      const filtered = history.filter((msg) => msg.timestamp !== timestamp);

      if (filtered.length === history.length) {
        logger.warn("Message not found for deletion", "Storage");
        return false;
      }

      await Preferences.set({
        key: CONVERSATION_STORAGE_KEY,
        value: JSON.stringify(filtered),
      });

      logger.debug(
        `Deleted message with timestamp ${timestamp}. Remaining messages: ${filtered.length}`,
        "Storage"
      );
      return true;
    } catch (error) {
      logger.error(
        "Error deleting message",
        "Storage",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  });
}

export async function getPersistentContext(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: PERSISTENT_CONTEXT_KEY });
    return value || "";
  } catch (error) {
    logger.error(
      "Error reading persistent context",
      "Storage",
      error instanceof Error ? error : new Error(String(error))
    );
    return "";
  }
}

export async function updatePersistentContext(
  contextText: string
): Promise<void> {
  try {
    await Preferences.set({
      key: PERSISTENT_CONTEXT_KEY,
      value: contextText.trim(),
    });
    logger.debug(
      `Updated persistent context (${contextText.length} chars)`,
      "Storage"
    );
  } catch (error) {
    logger.error(
      "Error updating persistent context",
      "Storage",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function clearPersistentContext(): Promise<void> {
  try {
    await Preferences.remove({ key: PERSISTENT_CONTEXT_KEY });
    await Preferences.remove({ key: PERSISTENT_CONTEXT_PERSONA_KEY });
    logger.debug("Persistent context cleared", "Storage");
  } catch (error) {
    logger.error(
      "Error clearing persistent context",
      "Storage",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function getPersistentContextPersonaId(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({
      key: PERSISTENT_CONTEXT_PERSONA_KEY,
    });
    return value || null;
  } catch (error) {
    logger.error(
      "Error reading persistent context persona ID",
      "Storage",
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

export async function setPersistentContextPersonaId(
  personaId: string
): Promise<void> {
  try {
    await Preferences.set({
      key: PERSISTENT_CONTEXT_PERSONA_KEY,
      value: personaId,
    });
    logger.debug(`Set persistent context persona ID: ${personaId}`, "Storage");
  } catch (error) {
    logger.error(
      "Error setting persistent context persona ID",
      "Storage",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function formatConversationContext(
  excludeLastUserMessage?: boolean
): Promise<string> {
  const persistentContext = await getPersistentContext();
  const contextParts: string[] = [];

  // Add persistent context (with size limit)
  if (persistentContext && persistentContext.trim().length > 0) {
    const trimmed = persistentContext.trim();
    // Limit persistent context to 1000 chars to leave room for messages
    const limited = trimmed.length > 1000 
      ? trimmed.substring(0, 1000) + "..."
      : trimmed;
    contextParts.push(limited);
  }

  // Get recent messages
  const allMessages = await getLastTurns(MAX_CONTEXT_TURNS);

  if (allMessages.length > 0) {
    const sortedMessages = allMessages.sort(
      (a, b) => a.timestamp - b.timestamp
    );

    let messagesToFormat = sortedMessages;
    if (excludeLastUserMessage && sortedMessages.length > 0) {
      const lastMessage = sortedMessages[sortedMessages.length - 1];
      if (lastMessage.role === "user") {
        messagesToFormat = sortedMessages.slice(0, -1);
      }
    }

    // Take only most recent messages
    const contextMessages = messagesToFormat.slice(-MAX_CONTEXT_TURNS);

    // Format messages concisely
    const formattedMessages = contextMessages
      .map((msg) => {
        // Use shorter role labels to save space
        const roleLabel = msg.role === "user" ? "U" : "A";
        // Truncate very long messages
        const text = msg.text.length > 500 
          ? msg.text.substring(0, 500) + "..."
          : msg.text;
        return `${roleLabel}: ${text}`;
      })
      .join("\n\n");

    if (formattedMessages.trim().length > 0) {
      contextParts.push(formattedMessages);
    }
  }

  let formatted = contextParts.join("\n\n");

  // Aggressive truncation if needed
  if (formatted.length > MAX_CONTEXT_CHARS) {
    // Try to truncate from the beginning while preserving persistent context
    if (persistentContext && persistentContext.length > MAX_CONTEXT_CHARS / 2) {
      const messagesPart = contextParts.length > 1 ? contextParts[1] : "";
      if (messagesPart) {
        const availableChars = MAX_CONTEXT_CHARS - persistentContext.length - 4;
        if (availableChars > 100) {
          // Truncate messages from the beginning
          const truncateAt = messagesPart.lastIndexOf("\n\n", availableChars);
          if (truncateAt > availableChars / 2) {
            formatted =
              persistentContext +
              "\n\n" +
              messagesPart.substring(truncateAt + 2);
          } else {
            // Just take the end of messages
            formatted =
              persistentContext +
              "\n\n" +
              messagesPart.substring(messagesPart.length - availableChars);
          }
        } else {
          // Not enough room for messages, just use persistent context
          formatted = persistentContext;
        }
      }
    } else {
      // Truncate from the beginning, keeping most recent content
      formatted = formatted.substring(formatted.length - MAX_CONTEXT_CHARS);
      // Try to start at a message boundary
      const firstNewline = formatted.indexOf("\n\n");
      if (firstNewline > 0 && firstNewline < 100) {
        formatted = formatted.substring(firstNewline + 2);
      }
    }
  }

  return formatted;
}

export async function getConversationContextArray(): Promise<
  Array<{ role: string; content: string }>
> {
  const messages = await getLastTurns(MAX_CONVERSATION_TURNS);

  return messages.map((msg) => ({
    role: msg.role,
    content: msg.text,
  }));
}