import React, { useState, useEffect } from 'react';
import { Bomb, Gift, CheckCircle2 } from 'lucide-react';

interface ClaimEvent {
  envelopeId: string;
  playerId: string;
  amountUnits?: number;
  penaltyUnits?: number;
  mineHit?: boolean;
}

export function ClaimHistory() {
  const [events, setEvents] = useState<ClaimEvent[]>([]);

  useEffect(() => {
    // Listen to SSE
    const evtSource = new EventSource('http://localhost:4200/red-envelope/stream');
    
    evtSource.addEventListener('PACKET_CLAIMED', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => [{ ...data, mineHit: false }, ...prev].slice(0, 50));
    });

    evtSource.addEventListener('MINE_HIT', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => {
        // Find the claim event and update it to a mine hit
        const idx = prev.findIndex(ev => ev.envelopeId === data.envelopeId && ev.playerId === data.playerId);
        if (idx !== -1) {
          const newEvents = [...prev];
          newEvents[idx] = { ...newEvents[idx], ...data, mineHit: true };
          return newEvents;
        }
        return [{ ...data, mineHit: true }, ...prev].slice(0, 50);
      });
    });

    return () => evtSource.close();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
      {events.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-zinc-500">
          <p>Waiting for claims...</p>
        </div>
      ) : (
        events.map((ev, i) => (
          <div key={i} className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${
            ev.mineHit 
              ? 'bg-red-950/20 border-red-900/30' 
              : 'bg-zinc-800/50 border-zinc-700/50'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                ev.mineHit ? 'bg-red-900/50 text-red-500' : 'bg-green-900/30 text-green-500'
              }`}>
                {ev.mineHit ? <Bomb className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              </div>
              <div>
                <div className="text-sm font-bold text-zinc-200">
                  {ev.playerId.substring(0, 8)}...
                </div>
                <div className="text-xs text-zinc-500">
                  {ev.mineHit ? 'Hit a mine!' : 'Claimed safely'}
                </div>
              </div>
            </div>

            <div className={`font-bold text-right ${
              ev.mineHit ? 'text-red-500' : 'text-yellow-500'
            }`}>
              {ev.mineHit 
                ? `-${((ev.penaltyUnits || 0) / 100).toFixed(2)}`
                : `+${((ev.amountUnits || 0) / 100).toFixed(2)}`
              }
            </div>
          </div>
        ))
      )}
    </div>
  );
}
