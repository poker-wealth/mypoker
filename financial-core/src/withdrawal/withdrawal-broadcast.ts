import { Money } from '../domain/money';
import { WithdrawalState } from '../domain/withdrawal-types';
import { WithdrawalNotFoundError } from '../wallet/errors';
import { WithdrawalModel } from './withdrawal.model';
import { broadcastWithdrawal, rollbackWithdrawal } from './withdrawal-state-machine';
import { signAndBroadcastTransfer, usdtToUnits, type SignerConfig } from './tron-signer';
import { hotWalletKey, tronApiUrl, tronApiKey, usdtContract, withdrawalFeeLimitSun } from '../config/chain';

/**
 * The on-chain leg of a withdrawal: turn an APPROVED withdrawal (funds already held in clearing) into
 * a signed, broadcast USDT transfer, then record its real txHash. Kept separate from the ledger
 * state machine so the money movement (ledger) and the chain movement (signing) are independently
 * reviewable, and so the hot key is only imported here.
 */

/** Build the signer config from the environment. Throws if no hot-wallet key is provisioned yet. */
export function signerConfigFromEnv(): SignerConfig {
  const key = hotWalletKey();
  if (!key) throw new Error('TRON_HOT_WALLET_KEY is not set — withdrawals cannot be broadcast');
  return {
    apiUrl: tronApiUrl(),
    apiKey: tronApiKey(),
    contractAddress: usdtContract(),
    privateKeyHex: key,
    feeLimitSun: withdrawalFeeLimitSun(),
  };
}

/**
 * Take an APPROVED withdrawal on-chain. Builds → signs → broadcasts the transfer from the hot wallet,
 * then advances the withdrawal to BROADCASTING with the real txHash. ANY signing/broadcast failure
 * rolls the withdrawal back, releasing the clearing hold to the player's available balance — so a
 * failed send never strands the player's money. Returns the on-chain txHash.
 */
export async function signAndBroadcastWithdrawal(
  withdrawalId: string,
  cfg: SignerConfig = signerConfigFromEnv(),
): Promise<string> {
  const w = await WithdrawalModel.findById(withdrawalId);
  if (!w) throw new WithdrawalNotFoundError(withdrawalId);
  if (w.state !== WithdrawalState.APPROVED) {
    throw new Error(`withdrawal ${withdrawalId} is ${w.state}, expected APPROVED`);
  }
  const amountUnits = usdtToUnits(Money.fromDecimal128(w.amount).toString());

  let txHash: string;
  try {
    txHash = await signAndBroadcastTransfer(cfg, w.address, amountUnits);
  } catch (err) {
    await rollbackWithdrawal(
      withdrawalId,
      `broadcast failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  await broadcastWithdrawal(withdrawalId, txHash);
  return txHash;
}
