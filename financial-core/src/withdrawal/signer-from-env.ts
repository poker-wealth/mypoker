import { LocalPrivateKeySigner, type TronSigner } from './tron-signer';
import { hotWalletKey } from '../config/chain';

/**
 * Choose the withdrawal key backend from the environment. This is the ONE place that decides where
 * the hot-wallet key lives; everything downstream sees only the {@link TronSigner} port.
 *
 *   - `AWS_KMS_CMK_ARN` set → the key never leaves AWS KMS; signing is a KMS API call (spec §3.4,
 *     the mainnet target). [wired in Phase 2 — see kms-signer.ts]
 *   - else `TRON_HOT_WALLET_KEY` set → a local private key in this process (the MVP / testnet path).
 *   - else → throw, so a misconfigured deploy fails loudly instead of silently being unable to pay out.
 *
 * Moving from a local key to KMS is therefore a config change (set the ARN), not a code change: the
 * withdrawal state machine and broadcast path are identical either way.
 */
export function signerFromEnv(): TronSigner {
  const kmsArn = process.env.AWS_KMS_CMK_ARN?.trim();
  if (kmsArn) {
    // Phase 2 plugs the KMS signer in here, keyed by the ARN. Until then, fail clearly rather than
    // silently fall back to a local key when an operator explicitly asked for KMS.
    throw new Error('AWS_KMS_CMK_ARN is set but the KMS signer is not wired yet (Phase 2)');
  }

  const key = hotWalletKey();
  if (!key) {
    throw new Error(
      'no withdrawal key backend configured — set TRON_HOT_WALLET_KEY (local) or AWS_KMS_CMK_ARN (KMS)',
    );
  }
  return new LocalPrivateKeySigner(key);
}
