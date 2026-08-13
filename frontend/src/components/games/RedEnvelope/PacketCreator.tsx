import { useState } from 'react';
import { X, Bomb, Coins, Users } from 'lucide-react';
import { Button } from '../../ui/Button';

interface Props {
  onClose: () => void;
}

export function PacketCreator({ onClose }: Props) {
  const [totalAmount, setTotalAmount] = useState('100.00');
  const [packetCount, setPacketCount] = useState('10');
  const [mineNumber, setMineNumber] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const units = Math.floor(parseFloat(totalAmount) * 100);

    try {
      const res = await fetch('http://localhost:4200/red-envelope', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-player-id': 'player_test_123'
        },
        body: JSON.stringify({
          totalAmountUnits: units,
          packetCount: parseInt(packetCount, 10),
          mineNumber
        })
      });

      if (res.ok) {
        onClose();
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        <div className="flex justify-between items-center p-6 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Create Red Envelope
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
              <Coins className="w-4 h-4" /> Total Pool Amount
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-bold">$</span>
              <input 
                type="number" 
                min="1"
                step="0.01"
                required
                value={totalAmount}
                onChange={e => setTotalAmount(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-white font-bold text-lg focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                <Users className="w-4 h-4" /> Packet Count
              </label>
              <input 
                type="number" 
                min="2"
                max="100"
                required
                value={packetCount}
                onChange={e => setPacketCount(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 text-white font-bold focus:outline-none focus:border-red-500 transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-red-400 flex items-center gap-2">
                <Bomb className="w-4 h-4" /> Mine Digit
              </label>
              <input 
                type="number" 
                min="0"
                max="9"
                required
                value={mineNumber}
                onChange={e => setMineNumber(parseInt(e.target.value))}
                className="w-full bg-red-950/20 border border-red-900/50 rounded-xl py-3 px-4 text-red-400 font-bold focus:outline-none focus:border-red-500 transition-all"
              />
            </div>
          </div>

          <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-4 text-sm text-zinc-300">
            If a player claims a packet and the last decimal digit is <strong className="text-red-400">{mineNumber}</strong>, they hit the mine and pay <strong className="text-red-400">1.5x</strong> their claimed amount!
          </div>

          <Button 
            type="submit" 
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold h-14 rounded-xl text-lg shadow-lg shadow-red-900/30 transition-all"
          >
            {loading ? 'Planting Mines...' : 'Create & Deal Packets'}
          </Button>
        </form>

      </div>
    </div>
  );
}
