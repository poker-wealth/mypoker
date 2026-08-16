import { Gift } from 'lucide-react';

export function ClaimAnimation() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="flex flex-col items-center animate-bounce-slow">
        {/* Envelope Graphic */}
        <div className="relative w-48 h-64 bg-red-600 rounded-lg shadow-2xl shadow-red-600/50 flex flex-col items-center justify-center overflow-hidden animate-pulse">
          
          {/* Flap */}
          <div className="absolute top-0 w-0 h-0 border-l-[96px] border-l-transparent border-r-[96px] border-r-transparent border-t-[80px] border-t-red-700 drop-shadow-md z-10" />
          
          {/* Gold Coin/Seal */}
          <div className="absolute top-[60px] z-20 w-16 h-16 rounded-full bg-yellow-400 flex items-center justify-center border-2 border-yellow-200 shadow-inner">
            <Gift className="w-8 h-8 text-yellow-700" />
          </div>

          <div className="mt-16 text-yellow-400 font-bold tracking-widest uppercase">Opening...</div>
        </div>
      </div>
    </div>
  );
}
