import { useState, useCallback, useEffect } from 'react';
import type { TableSocket } from '@/api/tableSocket';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export function useTableChat(socket: TableSocket | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!socket) return;
    
    const handleEvent = (data: unknown) => {
      setMessages(prev => [...prev, data as ChatMessage].slice(-100)); // Keep last 100 messages
    };

    socket.on('chat_message', handleEvent);
    
    return () => {
      socket.off('chat_message', handleEvent);
    };
  }, [socket]);

  const sendChat = useCallback((text: string) => {
    if (!socket || !text.trim()) return;
    socket.send({ kind: 'chat', message: text.trim() });
  }, [socket]);

  return { messages, sendChat };
}
