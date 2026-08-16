import { Bomb, CheckCircle2 } from 'lucide-react';
import { Button } from '../../ui/Button';

interface Props {
  result: any;
  onClose: () => void;
}

export function HitMineAnimation({ result, onClose }: Props) {
  const isMineHit = result.mineHit;

  return (
    <div className={`absolute inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-colors duration-500 ${isMineHit ? 'bg-red-950/80' : 'bg-black/60'}`}>
      
      {/* Container */}
      <div className={`relative border rounded-3xl w-full max-w-sm p-8 flex flex-col items-center text-center shadow-2xl animate-in zoom-in-90 duration-300 ${
        isMineHit 
          ? 'bg-zinc-900 border-red-500 shadow-red-900/50' 
          : 'bg-zinc-900 border-yellow-500 shadow-yellow-900/20'
      }`}>
        
        {isMineHit ? (
          <>
            <div className="absolute inset-0 bg-red-500/10 rounded-3xl animate-pulse" />
            <div className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(220,38,38,0.6)]">
              <Bomb className="w-12 h-12 text-white animate-bounce" />
            </div>
            <h2 className="text-3xl font-black text-white mb-2">BOOM!</h2>
            <p className="text-red-400 font-bold text-xl mb-4">You hit a mine!</p>
            
            <div className="bg-red-950/50 border border-red-900/50 rounded-xl p-4 w-full mb-6">
              <div className="text-zinc-400 text-sm mb-1">Penalty Paid</div>
              <div className="text-3xl font-black text-red-500">
                -{(result.penaltyUnits / 100).toFixed(2)}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="w-24 h-24 bg-yellow-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(234,179,8,0.3)]">
              <CheckCircle2 className="w-12 h-12 text-yellow-950" />
            </div>
            <h2 className="text-3xl font-black text-white mb-2">Lucky!</h2>
            <p className="text-yellow-400 font-bold text-xl mb-4">You escaped safely!</p>
            
            <div className="bg-yellow-950/20 border border-yellow-900/30 rounded-xl p-4 w-full mb-6">
              <div className="text-zinc-400 text-sm mb-1">Amount Claimed</div>
              <div className="text-3xl font-black text-yellow-500">
                +{(result.amountUnits / 100).toFixed(2)}
              </div>
            </div>
          </>
        )}

        <Button 
          onClick={onClose}
          className={`w-full font-bold h-12 rounded-xl text-lg ${
            isMineHit 
              ? 'bg-red-600 hover:bg-red-500 text-white' 
              : 'bg-yellow-500 hover:bg-yellow-400 text-yellow-950'
          }`}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
