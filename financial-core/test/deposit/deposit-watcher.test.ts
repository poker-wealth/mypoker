import { startTestDb, stopTestDb, clearCollections } from '../db-helper';
import { DepositAddressModel } from '../../src/wallet/deposit-address';
import { pollDepositsOnce, type TransferSource } from '../../src/deposit/deposit-watcher';
import { getOrCreatePlayerAccount } from '../../src/wallet/system-accounts';
import { Money } from '../../src/domain/money';

const TEST_USDT = 'TTestUSDTContractAddress000000000000';
const OTHER_TOKEN = 'TSomeOtherTokenContract0000000000000';
const ADDR = 'TG5WDWGSZAKj7i3iXUbDqiLecP4hVK1Vd2';
const PLAYER = 'player-1';

beforeAll(async () => {
  await startTestDb();
  process.env.USDT_TRC20_CONTRACT = TEST_USDT;
  process.env.DEPOSIT_CONFIRMATIONS = '1';
});
afterAll(async () => {
  // Don't leak the testnet contract/confirmations into other suites in a full run.
  delete process.env.USDT_TRC20_CONTRACT;
  delete process.env.DEPOSIT_CONFIRMATIONS;
  await stopTestDb();
});
afterEach(clearCollections);

const seedAddress = (): Promise<unknown> =>
  DepositAddressModel.create({ _id: PLAYER, index: 1, address: ADDR });

async function available(playerId: string): Promise<string> {
  const acc = await getOrCreatePlayerAccount(playerId);
  return Money.fromDecimal128(acc.availableBalance).toString();
}

const goodTransfer: TransferSource = async (addr) =>
  addr === ADDR
    ? [{ txHash: 'tx-1', to: ADDR, contract: TEST_USDT, amount: '500.000000', confirmations: 1 }]
    : [];

describe('deposit-watcher', () => {
  it('credits a confirmed USDT transfer to the address owner', async () => {
    await seedAddress();
    const r = await pollDepositsOnce(goodTransfer);
    expect(r.credited).toBe(1);
    expect(await available(PLAYER)).toBe('500.000000');
  });

  it('is idempotent — the same tx credits exactly once', async () => {
    await seedAddress();
    await pollDepositsOnce(goodTransfer);
    const second = await pollDepositsOnce(goodTransfer); // same tx-1
    expect(second.credited).toBe(0);
    expect(await available(PLAYER)).toBe('500.000000');
  });

  it('never credits a transfer of a different token', async () => {
    await seedAddress();
    const wrong: TransferSource = async () => [
      { txHash: 'tx-2', to: ADDR, contract: OTHER_TOKEN, amount: '999.000000', confirmations: 1 },
    ];
    const r = await pollDepositsOnce(wrong);
    expect(r.credited).toBe(0);
    expect(await available(PLAYER)).toBe('0.000000');
  });

  it('never credits an unconfirmed transfer', async () => {
    process.env.DEPOSIT_CONFIRMATIONS = '20';
    await seedAddress();
    const pending: TransferSource = async () => [
      { txHash: 'tx-3', to: ADDR, contract: TEST_USDT, amount: '100.000000', confirmations: 3 },
    ];
    const r = await pollDepositsOnce(pending);
    expect(r.credited).toBe(0);
    expect(await available(PLAYER)).toBe('0.000000');
    process.env.DEPOSIT_CONFIRMATIONS = '1';
  });
});
