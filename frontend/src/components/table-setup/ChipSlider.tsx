import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';
import { PokerChip } from './PokerChip';

/**
 * The reference app's slider: a row of labelled stops, a thin track with a dot
 * at each stop, and a poker chip for a thumb.
 *
 * Discrete on purpose — every control on the create screen chooses from a
 * short list (stakes, seats, antes), and a continuous slider would invite
 * values the server refuses. Stops carry their own labels so the caller
 * decides how a value reads ("None", "9", "$0.10/0.20").
 *
 * A custom widget rather than <input type=range> because the design needs
 * per-stop labels, dots and a chip thumb, which a native range cannot draw.
 * The keyboard/AT contract is kept by hand: role="slider", arrow keys,
 * aria-valuetext.
 */
export interface SliderStop {
  value: number;
  label: string;
}

/** Shared geometry: where stop i sits, as a CSS % along the track. */
const pct = (i: number, n: number): number => (n <= 1 ? 0 : (i / (n - 1)) * 100);

/** The nearest stop index for a pointer at `clientX` over track `rect`. */
function indexAt(clientX: number, rect: DOMRect, n: number): number {
  const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(fraction * (n - 1));
}

export function ChipSlider({
  stops,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  stops: SliderStop[];
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const n = stops.length;
  const index = Math.max(
    0,
    stops.findIndex((s) => s.value === value),
  );

  const moveTo = (i: number): void => {
    const stop = stops[Math.min(n - 1, Math.max(0, i))];
    if (!stop || stop.value === value) return;
    haptic('light');
    onChange(stop.value);
  };

  const fromPointer = (e: PointerEvent): void => {
    if (disabled || !trackRef.current) return;
    moveTo(indexAt(e.clientX, trackRef.current.getBoundingClientRect(), n));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (disabled) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') moveTo(index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') moveTo(index - 1);
    else if (e.key === 'Home') moveTo(0);
    else if (e.key === 'End') moveTo(n - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className={cn('select-none', disabled && 'opacity-45')}>
      {/* Stop labels, each centred over its dot. */}
      <div className="relative mb-1.5 h-4 text-[0.66rem] font-medium text-dim">
        {stops.map((stop, i) => (
          <span
            key={stop.value}
            className={cn(
              'absolute -translate-x-1/2 whitespace-nowrap tabular-nums',
              i === index && 'font-bold text-text',
            )}
            style={{ left: `${pct(i, n)}%` }}
          >
            {stop.label}
          </span>
        ))}
      </div>

      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={index}
        aria-valuetext={stops[index]?.label}
        aria-disabled={disabled || undefined}
        className="relative touch-none py-2.5 outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-brand"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
      >
        <div ref={trackRef} className="relative h-1 rounded-full bg-surface-2">
          {stops.map((stop, i) => (
            <span
              key={stop.value}
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border"
              style={{ left: `${pct(i, n)}%` }}
            />
          ))}
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct(index, n)}%` }}
          >
            <PokerChip size={26} muted={disabled} className="block" />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The two-thumb variant, for the buy-in range: chip thumbs at the chosen
 * minimum and maximum with the reference's gold fill between them.
 *
 * A drag (or tap) moves whichever thumb is nearer; ties go to the low thumb.
 * The thumbs may share a stop — a fixed buy-in is a legal table — but never
 * cross. Keyboard: the whole control is one slider per thumb, each focusable.
 */
export function ChipRangeSlider({
  stops,
  low,
  high,
  onChange,
  ariaLabelLow,
  ariaLabelHigh,
}: {
  stops: SliderStop[];
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  ariaLabelLow: string;
  ariaLabelHigh: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'low' | 'high' | null>(null);
  const n = stops.length;
  const li = Math.max(0, stops.findIndex((s) => s.value === low));
  const hi = Math.max(0, stops.findIndex((s) => s.value === high));

  const apply = (thumb: 'low' | 'high', i: number): void => {
    const bounded = Math.min(n - 1, Math.max(0, i));
    const next: [number, number] =
      thumb === 'low'
        ? [Math.min(bounded, hi), hi]
        : [li, Math.max(bounded, li)];
    const [nl, nh] = [stops[next[0]]!.value, stops[next[1]]!.value];
    if (nl === low && nh === high) return;
    haptic('light');
    onChange(nl, nh);
  };

  const fromPointer = (e: PointerEvent): void => {
    if (!trackRef.current) return;
    const i = indexAt(e.clientX, trackRef.current.getBoundingClientRect(), n);
    // A drag keeps its thumb; a fresh press claims the nearer one.
    const thumb =
      dragging.current ?? (Math.abs(i - li) <= Math.abs(i - hi) ? 'low' : 'high');
    dragging.current = thumb;
    apply(thumb, i);
  };

  const keyFor =
    (thumb: 'low' | 'high') =>
    (e: KeyboardEvent): void => {
      const at = thumb === 'low' ? li : hi;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') apply(thumb, at + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') apply(thumb, at - 1);
      else return;
      e.preventDefault();
    };

  return (
    <div className="select-none">
      <div className="relative mb-1.5 h-4 text-[0.66rem] font-medium text-dim">
        {stops.map((stop, i) => (
          <span
            key={stop.value}
            className={cn(
              'absolute -translate-x-1/2 whitespace-nowrap tabular-nums',
              (i === li || i === hi) && 'font-bold text-text',
            )}
            style={{ left: `${pct(i, n)}%` }}
          >
            {stop.label}
          </span>
        ))}
      </div>

      <div
        className="relative touch-none py-2.5"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
      >
        <div ref={trackRef} className="relative h-1 rounded-full bg-surface-2">
          {/* The chosen range, in the reference's gold. */}
          <span
            className="absolute top-0 h-full rounded-full bg-gold"
            style={{ left: `${pct(li, n)}%`, width: `${pct(hi, n) - pct(li, n)}%` }}
          />
          {stops.map((stop, i) => (
            <span
              key={stop.value}
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border"
              style={{ left: `${pct(i, n)}%` }}
            />
          ))}
          {(
            [
              ['low', li, ariaLabelLow],
              ['high', hi, ariaLabelHigh],
            ] as const
          ).map(([thumb, at, label]) => (
            <span
              key={thumb}
              role="slider"
              tabIndex={0}
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={n - 1}
              aria-valuenow={at}
              aria-valuetext={stops[at]?.label}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-brand"
              style={{ left: `${pct(at, n)}%` }}
              onKeyDown={keyFor(thumb)}
            >
              <PokerChip size={26} className="block" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
