import { useState, useRef, useEffect } from 'react';
import { Send, MessageSquareOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { ChatMessage } from '@/hooks/useTableChat';
import { useSession } from '@/store/session';

export function ChatBox({
  messages,
  onSend,
  disabled = false,
  placeholder = "Say something..."
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { player } = useSession();

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 scroll-smooth"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-dim italic">
            No messages yet. Be the first to say hello!
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = player?.playerId === msg.senderId;
            return (
              <div 
                key={msg.id} 
                className={`flex flex-col text-[0.75rem] leading-tight ${
                  msg.isSystem ? 'items-center opacity-70' : isMe ? 'items-end' : 'items-start'
                }`}
              >
                {!msg.isSystem && (
                  <span className="text-[0.6rem] font-bold text-dim mb-0.5">
                    {msg.senderName}
                  </span>
                )}
                <div 
                  className={`rounded-xl px-2.5 py-1.5 break-words max-w-[85%] shadow-sm ${
                    msg.isSystem 
                      ? 'bg-surface-2 text-dim italic px-3 text-[0.65rem] rounded-full' 
                      : isMe 
                        ? 'bg-brand/20 border border-brand/30 text-brand-fg' 
                        : 'bg-surface-2 border border-border text-text'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 p-2 border-t border-border/50">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? "Chat is disabled" : placeholder}
          disabled={disabled}
          maxLength={200}
          className="flex-1 rounded-full border border-border bg-bg/50 px-3 py-1.5 text-[0.8rem] text-text placeholder:text-dim focus:border-brand focus:outline-none"
        />
        <Button
          size="sm"
          disabled={!input.trim() || disabled} 
          className="rounded-full px-3"
        >
          {disabled ? <MessageSquareOff size={15} /> : <Send size={15} />}
        </Button>
      </form>
    </div>
  );
}
