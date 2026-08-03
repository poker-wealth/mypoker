import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/store/theme';

/**
 * Global brand header: the spade-M mark + MYPOKER wordmark (both auto-trimmed from
 * the source PNGs), and the theme toggle. Sticky, with a blurred bar and hairline
 * border so it reads as real app chrome. The -mx-4/px-4 pairing lets the bar bleed
 * to the shell's edges while keeping its content aligned to the page gutter.
 */
export function Header() {
  const { resolved, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-1 border-b border-border/60 bg-bg/80 px-4 py-3 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src="/brand/logo-mark.png"
            alt=""
            className="size-9 shrink-0"
            style={{ filter: 'drop-shadow(0 0 9px rgb(187 92 246 / 0.5))' }}
          />
          <img src="/brand/logo-wordmark.png" alt="MYPOKER" className="h-[26px] w-auto" />
        </div>
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="grid size-9 place-items-center rounded-full border border-border bg-surface text-dim transition-colors active:scale-95"
        >
          {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
