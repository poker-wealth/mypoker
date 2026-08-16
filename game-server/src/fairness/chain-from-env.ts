import { readFileSync } from 'node:fs';
import type { ChainClient } from './chain';
import { FakeChainClient } from './chain';
import { SolanaChainClient, keypairFromJson, addressOf } from './solana-client';
import { ResilientChainClient } from './resilient-chain';
import { FakeNotary, type NotaryClient } from './notary';
import { PolygonChainClient, httpEvmRpc } from './polygon-client';
import { Rfc3161Notary } from './rfc3161-notary';

/**
 * The chain client the process should actually use, decided once at boot.
 *
 *   SOLANA_RPC_URL  — e.g. https://api.devnet.solana.com (devnet now, mainnet
 *                     at launch, per the W3 plan)
 *   SOLANA_KEYPAIR  — path to a solana-keygen JSON file, or the JSON itself
 *
 * Both set → the real Solana client, wrapped in the 3-layer resilience ladder
 * (v6.0 §6.2). Either missing → the deterministic fake, and dev behaves as it
 * always has. The decision is logged either way, because "which notary is
 * this?" must never require reading a stack trace to answer.
 *
 * Honest about the ladder's lower layers: until a Polygon RPC and an RFC 3161
 * TSA are configured, L2 is a client that always declines and L3 is the dev
 * notary — so a Solana outage degrades to a LOCAL timestamp, clearly logged,
 * re-anchored when the chain recovers. That is the spec's own intended
 * degradation order; what is not acceptable is the top layer being fake, and
 * after this file it no longer is.
 */

/** A layer that is present in the ladder but not configured — always declines. */
class UnconfiguredChain implements ChainClient {
  constructor(private readonly name: string) {}
  getLatestBlockNumber(): Promise<number> {
    return Promise.reject(new Error(`${this.name} not configured`));
  }
  getBlockHash(): Promise<string> {
    return Promise.reject(new Error(`${this.name} not configured`));
  }
  commitMerkleRoot(): Promise<string> {
    return Promise.reject(new Error(`${this.name} not configured`));
  }
}

export function chainClientFromEnv(env: NodeJS.ProcessEnv = process.env): ChainClient {
  const rpcUrl = env.SOLANA_RPC_URL;
  const keypairRaw = env.SOLANA_KEYPAIR;

  if (!rpcUrl || !keypairRaw) {
    console.log('[chain] SOLANA_RPC_URL / SOLANA_KEYPAIR not set — using the deterministic fake');
    return new FakeChainClient();
  }

  // The env var may hold the JSON itself or a path to solana-keygen's file.
  const json = keypairRaw.trim().startsWith('[') ? keypairRaw : readFileSync(keypairRaw, 'utf8');
  const keypair = keypairFromJson(json);

  console.log(`[chain] Solana notary active — ${rpcUrl} as ${addressOf(keypair)}`);

  // L2 — Polygon, when a funded notary key + RPC are configured; else the decline stub, so the ladder
  // simply skips to L3. Off the critical path, and a fallback anyway, so a bad config degrades safely.
  const polyUrl = env.POLYGON_RPC_URL?.trim();
  const polyKey = env.POLYGON_NOTARY_KEY?.trim();
  const polygon: ChainClient =
    polyUrl && polyKey
      ? new PolygonChainClient(httpEvmRpc(polyUrl), polyKey, Number(env.POLYGON_CHAIN_ID ?? 137))
      : new UnconfiguredChain('polygon');
  console.log(`[chain] L2 Polygon: ${polyUrl && polyKey ? 'active' : 'unconfigured (degrades to L3)'}`);

  // L3 — a real RFC 3161 TSA when configured; else the deterministic dev notary.
  const tsaUrl = env.RFC3161_TSA_URL?.trim();
  const notary: NotaryClient = tsaUrl ? new Rfc3161Notary(tsaUrl) : new FakeNotary();
  console.log(`[chain] L3 RFC-3161: ${tsaUrl ? `active (${tsaUrl})` : 'dev notary'}`);

  return new ResilientChainClient(new SolanaChainClient(rpcUrl, keypair), polygon, notary);
}
