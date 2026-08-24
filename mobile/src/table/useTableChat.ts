import { useCallback, useEffect, useState } from 'react';
import type { TableSocket } from './tableSocket';
import type { ChatMessage } from '../components/poker/ChatBox';

/**
 * Table chat, as one hook.
 *
 * Ported from `frontend/src/hooks/useTableChat.ts`. Chat does not travel in the snapshot — it
 * arrives as `chat_message` and `voice_message` EVENTS — so this subscribes to the socket directly.
 *
 * The event payloads are exactly what game-server/src/live/poker-room.ts emits. Mirrored rather
 * than reinvented: a second idea of what a chat message looks like would drift into rendering a
 * field the server never sends.
 */

/** Cap the in-memory history. Voice clips are heavy — 100 of them is megabytes. */
const KEEP_TEXT = 100;
const KEEP_VOICE = 20;

/**
 * Trim history, bounding voice notes harder than text.
 *
 * Each clip is up to 24KB of base64 held in memory for as long as it stays in the list. On a phone,
 * an hour at a chatty table would otherwise accumulate more than the process can afford — so old
 * clips fall out well before old text.
 */
function trim(list: ChatMessage[]): ChatMessage[] {
  const recent = list.slice(-KEEP_TEXT);
  let voiceSeen = 0;
  // Walk backwards so the ones we keep are the newest.
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (!m?.voice) continue;
    voiceSeen++;
    if (voiceSeen > KEEP_VOICE) {
      // Drop the audio, keep the message: the row still shows that somebody spoke, which reads
      // better than a gap in the conversation.
      recent[i] = { ...m, voice: undefined, text: undefined };
    }
  }
  return recent;
}

export function useTableChat(socket: TableSocket | null): {
  messages: ChatMessage[];
  sendChat: (text: string) => void;
} {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!socket) return;

    const onText = (data: unknown): void => {
      setMessages((prev) => trim([...prev, data as ChatMessage]));
    };

    const onVoice = (data: unknown): void => {
      const d = data as {
        id: string;
        senderId: string;
        senderName: string;
        clip: string;
        durationMs: number;
        mime: string;
        timestamp: number;
      };
      setMessages((prev) =>
        trim([
          ...prev,
          {
            id: d.id,
            senderId: d.senderId,
            senderName: d.senderName,
            timestamp: d.timestamp,
            voice: { clip: d.clip, durationMs: d.durationMs, mime: d.mime },
          },
        ]),
      );
    };

    socket.on('chat_message', onText);
    // Subscribed even though this app cannot PLAY a clip yet: the row says a voice note arrived,
    // which is the honest thing to show. Dropping it would make the sender think it never sent.
    socket.on('voice_message', onVoice);

    return () => {
      socket.off('chat_message', onText);
      socket.off('voice_message', onVoice);
    };
  }, [socket]);

  const sendChat = useCallback(
    (text: string): void => {
      const message = text.trim();
      // The wire caps this at 200; the composer does too, so this is the last line of defence
      // rather than the only one.
      if (!message || !socket) return;
      socket.send({ kind: 'chat', message: message.slice(0, 200) });
    },
    [socket],
  );

  return { messages, sendChat };
}
