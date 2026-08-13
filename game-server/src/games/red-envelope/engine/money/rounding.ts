export type RoundingPolicy = 'ROUND_DOWN' | 'ROUND_UP' | 'ROUND_HALF_UP';

export function roundAccordingToPolicy(value: number, policy: RoundingPolicy): number {
  switch (policy) {
    case 'ROUND_DOWN':
      return Math.floor(value);
    case 'ROUND_UP':
      return Math.ceil(value);
    case 'ROUND_HALF_UP':
      return Math.round(value);
    default:
      throw new Error(`Unknown rounding policy: ${policy}`);
  }
}
