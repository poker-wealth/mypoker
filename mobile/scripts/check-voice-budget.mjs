#!/usr/bin/env node
/**
 * Checks that a full-length voice note actually fits the wire budget.
 *
 * This exists because the failure is silent and total. The server refuses a
 * clip over MAX_VOICE_BYTES, so a bitrate set too high means every ten-second
 * recording is rejected — a feature that looks fine in a three-second test and
 * is broken for everyone in practice. The arithmetic is the only part of it
 * that can be checked without a microphone, so it is checked here.
 *
 * It also pins the client's constants to the SERVER's. game-server owns the
 * real ceilings; if someone changes a cap there and not here, the two drift and
 * the client starts sending clips the server will not take. That cross-package
 * check is the main reason this script is worth having.
 *
 * Run: npm run check:voice-budget
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(here, '..', 'src', 'useVoiceRecorder.ts');
const SERVER = path.join(here, '..', '..', 'game-server', 'src', 'social', 'voice.ts');

/**
 * MPEG-4 container overhead for a short recording — moov/ftyp atoms and frame
 * headers. Generous on purpose: the point is a margin that survives an encoder
 * being less efficient than advertised, not a tight prediction.
 */
const CONTAINER_ALLOWANCE = 3 * 1024;

/** The table socket's frame cap. `ws` FAILS THE CONNECTION above this. */
const WS_FRAME_LIMIT = 64 * 1024;

function readConst(file, name) {
  const src = readFileSync(file, 'utf8');
  // Matches `export const NAME = 10_000;` and `const NAME = 24 * 1024;`
  const m = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([^;]+);`).exec(src);
  if (!m) throw new Error(`could not find ${name} in ${path.basename(file)}`);
  const expr = m[1].replace(/_/g, '').trim();
  if (!/^[\d*+\s/-]+$/.test(expr)) throw new Error(`${name} is not a plain number: ${expr}`);
  return Number(new Function(`return (${expr})`)());
}

const fail = [];
const note = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) fail.push(label);
};

const client = {
  maxMs: readConst(CLIENT, 'MAX_MS'),
  minMs: readConst(CLIENT, 'MIN_MS'),
  maxBytes: readConst(CLIENT, 'MAX_BYTES'),
  bitsPerSecond: readConst(CLIENT, 'BITS_PER_SECOND'),
};

const server = {
  maxMs: readConst(SERVER, 'MAX_VOICE_DURATION_MS'),
  minMs: readConst(SERVER, 'MIN_VOICE_DURATION_MS'),
  maxBytes: readConst(SERVER, 'MAX_VOICE_BYTES'),
};

console.log('Voice note budget\n');
console.log(`  client: ${client.bitsPerSecond} bps, ${client.maxMs}ms max, ${client.maxBytes}B cap`);
console.log(`  server: ${server.maxMs}ms max, ${server.maxBytes}B cap\n`);

// ── The client must not believe in looser limits than the server enforces ────
note(client.maxMs === server.maxMs, 'max duration matches the server', `${client.maxMs} vs ${server.maxMs}`);
note(client.minMs === server.minMs, 'min duration matches the server', `${client.minMs} vs ${server.minMs}`);
note(client.maxBytes === server.maxBytes, 'byte cap matches the server', `${client.maxBytes} vs ${server.maxBytes}`);

// ── A full-length clip has to fit, with room for the container ───────────────
const audioBytes = (client.bitsPerSecond / 8) * (client.maxMs / 1000);
const worstCase = audioBytes + CONTAINER_ALLOWANCE;
const margin = client.maxBytes - worstCase;
note(
  worstCase <= client.maxBytes,
  'a full-length clip fits the cap',
  `${Math.round(audioBytes)}B audio + ${CONTAINER_ALLOWANCE}B container = ${Math.round(worstCase)}B of ${client.maxBytes}B (margin ${Math.round(margin)}B)`,
);

// ── base64 is what actually travels, and the socket dies above 64KB ──────────
const onWire = Math.ceil(client.maxBytes / 3) * 4;
note(
  onWire < WS_FRAME_LIMIT,
  'base64 payload stays under the frame limit',
  `${onWire}B of ${WS_FRAME_LIMIT}B`,
);

if (fail.length > 0) {
  console.log(`\n${fail.length} check(s) failed.`);
  console.log('A voice note that exceeds the cap is refused by the server every time,');
  console.log('so this is a silently broken feature rather than a degraded one.');
  process.exit(1);
}

console.log('\nAll checks passed.');
console.log('NOTE: this is arithmetic, not an encode. Real clip size must still be');
console.log('measured on a device — the encoder is free to ignore the bitrate hint.');
