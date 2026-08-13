import { useEffect, useState } from 'react';

/**
 * The value, settled — updated only once it has stopped changing for `delayMs`.
 *
 * Used for search inputs, where the alternative is a request per keystroke:
 * typing an eight-character player id would otherwise fire seven queries whose
 * answers are all thrown away, and the last one is not guaranteed to arrive
 * last. Debouncing removes the race as well as the load.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    // Cleared on every change, so the timer only fires once typing pauses.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
