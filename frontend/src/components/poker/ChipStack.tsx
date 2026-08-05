import { cn } from '@/lib/cn';

const CHIP_COLORS = [
  { value: 1000, color: 'from-[#ffc107] to-[#b38600]', border: 'border-[#806000]', stripe: 'bg-black' },
  { value: 500, color: 'from-[#9c27b0] to-[#6a1b9a]', border: 'border-[#4a148c]', stripe: 'bg-white' },
  { value: 100, color: 'from-[#424242] to-[#212121]', border: 'border-black', stripe: 'bg-white' },
  { value: 25, color: 'from-[#4caf50] to-[#2e7d32]', border: 'border-[#1b5e20]', stripe: 'bg-white' },
  { value: 5, color: 'from-[#f44336] to-[#c62828]', border: 'border-[#b71c1c]', stripe: 'bg-white' },
  { value: 1, color: 'from-[#2196f3] to-[#1565c0]', border: 'border-[#0d47a1]', stripe: 'bg-white' },
];

function getChipDistribution(amount: number) {
  let remaining = amount;
  const chips: { color: string; border: string; stripe: string; count: number }[] = [];
  for (const template of CHIP_COLORS) {
    if (remaining >= template.value) {
      const count = Math.floor(remaining / template.value);
      chips.push({ color: template.color, border: template.border, stripe: template.stripe, count });
      remaining %= template.value;
    }
  }
  return chips;
}

export function ChipStack({ amount, className, hideLabel }: { amount: number; className?: string; hideLabel?: boolean }) {
  if (amount <= 0) return null;

  const distribution = getChipDistribution(amount);
  
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div className="flex flex-wrap justify-center gap-1.5">
        {distribution.map((stack, i) => (
          <div key={i} className="relative flex flex-col-reverse items-center" style={{ width: '22px', height: `${10 + Math.min(stack.count, 6) * 3}px` }}>
            {Array.from({ length: Math.min(stack.count, 6) }).map((_, j) => (
              <div
                key={j}
                className={cn(
                  'absolute h-4 w-6 rounded-full border-b-[2px] border-x-[1px] border-t-[1px] shadow-[0_2px_4px_rgba(0,0,0,0.5)]',
                  'bg-gradient-to-br',
                  stack.color,
                  stack.border
                )}
                style={{
                  bottom: `${j * 3.5}px`,
                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 2px rgba(0,0,0,0.5), 0 3px 4px rgba(0,0,0,0.4)',
                }}
              >
                {/* Edge stripes for realistic chip detail */}
                <div className={cn("absolute top-0 bottom-0 left-[3px] w-[2px] opacity-70", stack.stripe)} />
                <div className={cn("absolute top-0 bottom-0 right-[3px] w-[2px] opacity-70", stack.stripe)} />
                <div className={cn("absolute left-0 right-0 top-[3px] h-[2px] opacity-70", stack.stripe)} />
                <div className={cn("absolute left-0 right-0 bottom-[3px] h-[2px] opacity-70", stack.stripe)} />

                {/* Inner sticker/ring */}
                <div className="absolute inset-[3px] rounded-full border border-dashed border-white/40 bg-black/10 mix-blend-overlay" />
              </div>
            ))}
          </div>
        ))}
      </div>
      
      {/* Label only shows if it's the main pot (via a generic class logic, or we just let caller handle it.
          For now, we remove the inner text block to keep it clean, the caller can render the text if needed,
          but let's keep it if we want it self-contained. Let's not render it here since PokerTable and PlayerSeat
          now render their own explicit text blocks for bets/pots. Wait, PlayerSeat doesn't render the text itself anymore!
          Ah, I removed the text from PlayerSeat! Let's put the text back here, styled cleanly. */}
      {amount > 0 && !hideLabel && (
         <div className="rounded bg-black/80 px-1.5 py-[1px] text-[0.6rem] font-black text-white/90 backdrop-blur-sm shadow-md border border-white/10 mt-1">
           {amount >= 1000 ? `${(amount / 1000).toFixed(1).replace('.0', '')}k` : amount}
         </div>
      )}
    </div>
  );
}
