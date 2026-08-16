import mongoose, { Schema, type Model } from 'mongoose';
import type { MerkleStore, MerkleRecord } from './merkle-aggregator';
import type { ProofNode } from './merkle';
import type { SeatedClientSeed } from './seed';

/**
 * Durable store for provably-fair round data + Merkle proofs (v5.9.1 / v6.0).
 *
 * Two jobs in one collection: (1) persist every settled round's full fairness inputs so a player can
 * verify a real hand end-to-end (steps 3–6 of the verifier), and (2) act as the aggregator's
 * `MerkleStore` — when a batch commits on-chain, the proof/root/tx are written back onto each round's
 * doc. Persisted so proofs survive a restart (the in-memory store loses them). Idempotent on roundId.
 *
 * Uses the process's existing mongoose connection (the folded gateway already connects for the user
 * store); the standalone dev table server, which has no DB, simply runs without notarization.
 */

export interface RoundFairnessDoc {
  _id: string; // roundId
  serverCommit: string;
  serverSeed: string;
  allClientSeeds: string;
  seatedClientSeeds: SeatedClientSeed[];
  futureBlockHash: string;
  finalSeed: string;
  cards: string[];
  timestamp: number;
  roundHash: string;
  // Filled when the batch is committed on-chain:
  merkleProof?: ProofNode[];
  merkleRoot?: string;
  chainTx?: string | null;
  batchFrom?: string;
  batchTo?: string;
  createdAt: Date;
}

const schema = new Schema<RoundFairnessDoc>(
  {
    _id: { type: String },
    serverCommit: { type: String, required: true },
    serverSeed: { type: String, required: true },
    allClientSeeds: { type: String, required: true },
    seatedClientSeeds: {
      type: [{ seatOrder: Number, clientSeed: String, _id: false }],
      default: [],
    },
    futureBlockHash: { type: String, required: true },
    finalSeed: { type: String, required: true },
    cards: { type: [String], default: [] },
    timestamp: { type: Number, required: true },
    roundHash: { type: String, required: true, index: true },
    merkleProof: { type: Schema.Types.Mixed },
    merkleRoot: { type: String },
    chainTx: { type: String, default: null },
    batchFrom: { type: String },
    batchTo: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, minimize: false },
);

export const RoundFairnessModel: Model<RoundFairnessDoc> =
  (mongoose.models.RoundFairness as Model<RoundFairnessDoc>) ??
  mongoose.model<RoundFairnessDoc>('RoundFairness', schema);

export type PersistRoundInput = Omit<
  RoundFairnessDoc,
  'merkleProof' | 'merkleRoot' | 'chainTx' | 'batchFrom' | 'batchTo' | 'createdAt'
>;

/** Persist a settled round's fairness inputs + its roundHash (before the batch is notarized). */
export async function persistRound(input: PersistRoundInput): Promise<void> {
  await RoundFairnessModel.updateOne(
    { _id: input._id },
    { $setOnInsert: input },
    { upsert: true },
  );
}

/** The full published record for one round, including its proof once the batch has committed. */
export async function getRoundFairness(roundId: string): Promise<RoundFairnessDoc | null> {
  return RoundFairnessModel.findById(roundId).lean();
}

/** A `MerkleStore` that writes each committed batch's proof/root/tx back onto its round docs. */
export class MongoMerkleStore implements MerkleStore {
  async save(records: MerkleRecord[]): Promise<void> {
    await Promise.all(
      records.map((r) =>
        RoundFairnessModel.updateOne(
          { _id: r.roundId },
          {
            $set: {
              merkleProof: r.merkleProof,
              merkleRoot: r.merkleRoot,
              chainTx: r.chainTx,
              batchFrom: r.batchFrom,
              batchTo: r.batchTo,
            },
          },
        ),
      ),
    );
  }

  async get(roundId: string): Promise<MerkleRecord | undefined> {
    const d = await RoundFairnessModel.findById(roundId).lean();
    if (!d || !d.merkleProof || !d.merkleRoot) return undefined;
    return {
      roundId: d._id,
      roundHash: d.roundHash,
      merkleProof: d.merkleProof,
      merkleRoot: d.merkleRoot,
      chainTx: d.chainTx ?? null,
      batchFrom: d.batchFrom ?? '',
      batchTo: d.batchTo ?? '',
    };
  }
}
