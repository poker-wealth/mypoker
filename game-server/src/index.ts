// FairPlay Game Server — entry point.
// The Unified State Machine framework lives in ./core. The WebSocket transport and the first game
// (Texas Hold'em) are wired in subsequent W2/W3 days.

export * from './core';
export * from './transport';
export * from './fairness';

if (require.main === module) {
  console.log('FairPlay Game Server — State Machine + secure WebSocket transport ready.');
}
