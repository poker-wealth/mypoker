import mongoose, { Schema, type Model } from 'mongoose';
import type { ChainClient } from './chain';
import { currentRuleManifest, ruleVersionFor, type RuleManifest } from './rule-version';

/**
 * Publish the rule manifest on-chain, once per version.
 *
 * Rules are static — they change a handful of times in a platform's life — so
 * committing them per round would be pure waste. They get committed when they
 * CHANGE, and each round simply records which committed version it ran under.
 * That ordering is the whole guarantee: the chain timestamp on a version
 * necessarily precedes every round that cites it, so the platform cannot decide
 * the rules after seeing the outcome.
 *
 * A single-leaf commitment: the "root" is the manifest hash itself, and the
 * round-id fields carry `rules:<version>` so an observer reading the chain can
 * tell a rule commitment from a round batch without off-chain context.
 *
 * FAILS SOFT. An unreachable chain must not stop the platform from dealing —
 * hands are still notarized and still verifiable step-by-step. What is lost is
 * the anchor for the published rate, and the feed says so rather than implying
 * an anchor that does not exist.
 */

export interface RuleCommitmentDoc {
  _id: string; // the version hash
  manifestRevision: number;
  /** The manifest as committed — kept so a published rate can be re-derived. */
  manifest: unknown;
  /** Chain tx id. Null when the chain was unreachable and this is unanchored. */
  txId: string | null;
  committedAt: Date;
}

const schema = new Schema<RuleCommitmentDoc>(
  {
    _id: { type: String },
    manifestRevision: { type: Number, required: true },
    manifest: { type: Schema.Types.Mixed, required: true },
    txId: { type: String, default: null },
    committedAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'rulecommitments' },
);

function model(): Model<RuleCommitmentDoc> {
  return (mongoose.models['RuleCommitment'] as Model<RuleCommitmentDoc>)
    ?? mongoose.model<RuleCommitmentDoc>('RuleCommitment', schema);
}

/**
 * Ensure the rules in force are committed. Idempotent on the version hash:
 * called on every boot, commits only when the rules have actually changed.
 */
export async function ensureRuleCommitment(
  chain: ChainClient,
  manifest: RuleManifest = currentRuleManifest(),
): Promise<RuleCommitmentDoc> {
  const M = model();
  const existing = await M.findById(manifest.version).lean<RuleCommitmentDoc | null>();
  // Already anchored — nothing to do. An existing row with a null txId means a
  // previous boot could not reach the chain, so retry the anchoring below.
  if (existing?.txId) return existing;

  let txId: string | null = null;
  try {
    txId = await chain.commitMerkleRoot({
      merkleRoot: manifest.version,
      roundCount: 1,
      fromRoundId: `rules:${manifest.version}`,
      toRoundId: `rules:${manifest.version}`,
    });
  } catch (err) {
    // Deliberately swallowed: see FAILS SOFT above.
    console.error('[rules] could not anchor the rule manifest on-chain:', err);
  }

  // Two audit findings live in this update's shape:
  //   - `txId` is written only when the anchor SUCCEEDED. Two instances booting
  //     together could otherwise race: A anchors, B's chain call fails, B's
  //     unconditional `$set {txId: null}` erased A's good anchor until the next
  //     boot re-anchored — a third chain tx to fix a self-inflicted wound.
  //   - `committedAt` is stamped when the ANCHOR lands, not when the row was
  //     first inserted. A row created by a failed boot and anchored a day later
  //     used to display the insert date as its on-chain commit date — a small
  //     lie in the one field whose entire job is honesty about timing.
  await M.updateOne(
    { _id: manifest.version },
    txId
      ? { $set: { manifestRevision: manifest.manifestRevision, manifest, txId, committedAt: new Date() } }
      : {
          $set: { manifestRevision: manifest.manifestRevision, manifest },
          $setOnInsert: { txId: null, committedAt: new Date() },
        },
    { upsert: true },
  );
  return (await M.findById(manifest.version).lean<RuleCommitmentDoc>())!;
}

/**
 * Anchor ONE table's rules — the single-game manifest whose hash is exactly the
 * version that table stamps on its rounds.
 *
 * This closes the loop the audit found open: rounds stamped a version that was
 * never anchored and whose preimage nothing published, so a player could not
 * re-derive it, let alone check its chain timestamp. A single-game manifest is
 * just a RuleManifest with one entry, so the storage, idempotency and fail-soft
 * behaviour are all the code above.
 */
export async function ensureGameRuleCommitment(
  chain: ChainClient,
  rules: RuleManifest['games'][number],
): Promise<RuleCommitmentDoc> {
  return ensureRuleCommitment(chain, {
    version: ruleVersionFor(rules),
    manifestRevision: currentRuleManifest().manifestRevision,
    games: [rules],
  });
}

/** The commitment for one version, or null if that version was never committed. */
export async function ruleCommitment(version: string): Promise<RuleCommitmentDoc | null> {
  return model().findById(version).lean<RuleCommitmentDoc | null>();
}
