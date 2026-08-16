import { useState, useEffect } from 'react';
import { PlusCircle, Bomb, History, Gift } from 'lucide-react';
import { Button } from '../../ui/Button';
import { PacketCreator } from './PacketCreator';
import { ClaimAnimation } from './ClaimAnimation';
import { HitMineAnimation } from './HitMineAnimation';
import { ClaimHistory } from './ClaimHistory';

export function RedEnvelopeDashboard() {
  const [envelopes, setEnvelopes] = useState<any[]>([]);
  const [showCreator, setShowCreator] = useState(false);
  const [claimingEnvelope, setClaimingEnvelope] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<any>(null);

  // Poll for envelopes (since we haven't wired EventSource into the frontend yet)
  useEffect(() => {
    const fetchEnvelopes = async () => {
      try {
        const res = await fetch('http://localhost:4200/red-envelope'); // adjust API url
        if (res.ok) {
          const data = await res.json();
          setEnvelopes(data.envelopes);
        }
      } catch (err) {
        console.error('Failed to fetch envelopes:', err);
      }
    };
    
    fetchEnvelopes();
    const interval = setInterval(fetchEnvelopes, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleClaim = async (envelopeId: string) => {
    setClaimingEnvelope(envelopeId);
    try {
      const res = await fetch(`http://localhost:4200/red-envelope/${envelopeId}/claim`, {
        method: 'POST',
        headers: {
          'x-player-id': 'player_test_123', // Demo user
        }
      });
      const data = await res.json();
      
      // Delay showing result to allow envelope opening animation to play
      setTimeout(() => {
        setClaimResult(data);
        setClaimingEnvelope(null);
      }, 1500);

    } catch (err) {
      console.error(err);
      setClaimingEnvelope(null);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 text-white overflow-hidden p-6 gap-6 relative">
      {/* Header */}
      <div className="flex justify-between items-center bg-zinc-900/80 p-6 rounded-2xl border border-red-900/30 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-red-600/20 rounded-xl">
            <Gift className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-red-400 to-orange-400 text-transparent bg-clip-text">
              Red Envelope Mine Sweeping
            </h1>
            <p className="text-zinc-400 font-medium">Claim your share before it explodes!</p>
          </div>
        </div>
        
        <Button 
          onClick={() => setShowCreator(true)}
          className="bg-red-600 hover:bg-red-500 text-white gap-2 h-12 px-6 rounded-xl font-bold shadow-lg shadow-red-900/50 transition-all hover:scale-105"
        >
          <PlusCircle className="w-5 h-5" />
          Create Envelope
        </Button>
      </div>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        
        {/* Active Envelopes (Left 2/3) */}
        <div className="lg:col-span-2 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-6 text-zinc-200">
            <Bomb className="w-5 h-5 text-red-500" /> 
            Active Envelopes
          </h2>
          
          {envelopes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 bg-zinc-900/40 rounded-2xl border border-zinc-800 border-dashed">
              <Gift className="w-16 h-16 text-zinc-600 mb-4 opacity-50" />
              <p className="text-zinc-400 font-medium text-lg">No active envelopes right now.</p>
              <p className="text-zinc-500 text-sm">Be the first to create one!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {envelopes.map(env => (
                <div key={env._id} className="relative bg-gradient-to-br from-red-950 to-zinc-900 p-6 rounded-2xl border border-red-900/50 hover:border-red-500/50 transition-all group overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500">
                    <Bomb className="w-32 h-32 text-red-500" />
                  </div>
                  
                  <div className="flex justify-between items-start mb-6 relative z-10">
                    <div>
                      <div className="text-xs text-red-400 font-bold uppercase tracking-wider mb-1">Mine Number</div>
                      <div className="text-4xl font-black text-white drop-shadow-md">{env.mineNumber}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Total Pool</div>
                      <div className="text-xl font-bold text-yellow-500">{(env.totalAmountUnits / 100).toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-red-900/30 relative z-10">
                    <div className="text-zinc-400 text-sm">
                      <span className="font-bold text-white">{env.remainingPackets}</span> / {env.packetCount} left
                    </div>
                    <Button 
                      onClick={() => handleClaim(env._id)}
                      disabled={claimingEnvelope === env._id}
                      className="bg-yellow-500 hover:bg-yellow-400 text-yellow-950 font-bold shadow-lg shadow-yellow-900/20 px-6 rounded-xl hover:scale-105 transition-transform"
                    >
                      {claimingEnvelope === env._id ? 'Opening...' : 'Grab It!'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Claim History (Right 1/3) */}
        <div className="bg-zinc-900/60 rounded-2xl border border-zinc-800 p-6 flex flex-col h-full overflow-hidden">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-zinc-200">
            <History className="w-5 h-5 text-zinc-400" /> 
            Live Claims
          </h2>
          <ClaimHistory />
        </div>
      </div>

      {/* Modals & Animations */}
      {showCreator && <PacketCreator onClose={() => setShowCreator(false)} />}
      
      {claimingEnvelope && !claimResult && <ClaimAnimation />}
      
      {claimResult && (
        <HitMineAnimation 
          result={claimResult} 
          onClose={() => setClaimResult(null)} 
        />
      )}
    </div>
  );
}
