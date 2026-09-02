import { useState, useCallback, useEffect, useRef } from 'react';
import type { TableSocket } from '@/api/tableSocket';
import type { VoiceClip } from './useVoiceRecorder';

/**
 * One message list for the table, carrying text and voice notes alike.
 *
 * A voice note is a chat message that happens to be audio — it arrives on the
 * same socket, obeys the same reputation/mute/rate rules, and belongs in the
 * same thread in the same order. Keeping two lists would only mean merging them
 * again at render time, and getting the ordering subtly wrong.
 */

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  isSystem?: boolean;
  /** Present on a typed message. */
  text?: string;
  /** Present on a voice note: base64 audio plus what is needed to play it. */
  voice?: { clip: string; durationMs: number; mime: string };
}

/** Cap the in-memory history. Voice clips are heavy — 100 of them is megabytes. */
const KEEP_TEXT = 100;
const KEEP_VOICE = 20;

/**
 * Trim history, bounding voice notes harder than text.
 *
 * Each clip is up to 24KB of base64 held in memory for as long as it stays in
 * the list. On a phone, an hour at a chatty table would otherwise accumulate
 * more than the tab can afford — so old clips fall out well before old text.
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
      // Drop the audio, keep the message: the row still shows that somebody
      // spoke, which reads better than a gap in the conversation.
      recent[i] = { ...m, voice: undefined, text: undefined };
    }
  }
  return recent;
}

/**
 * @param selfId the viewer's playerId, so their own messages never count as
 *   unread. Without it every message you send would badge your own button.
 */
export function useTableChat(socket: TableSocket | null, selfId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /**
   * Messages that have arrived since the player last looked.
   *
   * Chat lives behind a floating button, so an incoming message was completely
   * invisible — someone could be talked to for a whole session and never know.
   * A count on the button is the difference between a chat feature and a chat
   * feature nobody uses.
   */
  const [unread, setUnread] = useState(0);

  // Read through a ref so a change of identity does not tear down and re-attach
  // the socket listeners — which would drop any message arriving in that gap.
  const self = useRef(selfId);
  self.current = selfId;

  const markRead = useCallback(() => setUnread(0), []);

  useEffect(() => {
    if (!socket) return;

    const countIfTheirs = (senderId: string): void => {
      if (senderId !== self.current) setUnread((n) => n + 1);
    };

    const onText = (data: unknown): void => {
      const m = data as ChatMessage;
      setMessages((prev) => trim([...prev, m]));
      countIfTheirs(m.senderId);
    };
    const onVoice = (data: unknown): void => {
      const d = data as {
        id: string; senderId: string; senderName: string;
        clip: string; durationMs: number; mime: string; timestamp: number;
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
      countIfTheirs(d.senderId);
    };

    socket.on('chat_message', onText);
    socket.on('voice_message', onVoice);
    return () => {
      socket.off('chat_message', onText);
      socket.off('voice_message', onVoice);
    };
  }, [socket]);

  const sendChat = useCallback(
    (text: string) => {
      if (!socket || !text.trim()) return;
      socket.send({ kind: 'chat', message: text.trim() });
    },
    [socket],
  );

  const sendVoice = useCallback(
    (v: VoiceClip) => {
      if (!socket) return;
      socket.send({ kind: 'voice', clip: v.clip, durationMs: v.durationMs, mime: v.mime });
    },
    [socket],
  );

  return { messages, sendChat, sendVoice, unread, markRead };
}
