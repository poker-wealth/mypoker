import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';
import { DepositAddressModel } from '../../src/wallet/deposit-address';
import { SweepStateModel } from '../../src/deposit/sweep-state.model';
import { sweepOnce, deriveDepositPrivateKey, type SweepChain } from '../../src/deposit/sweep';

const TREASURY = 'TVcLoExcHcTM4Eq8Bbhmmg7xbzSNJ1PgjV';
const ADDR = 'TG5WDWGSZAKj7i3iXUbDqiLecP4hVK1Vd2';
const GAS_SUN = 30_000_000n; // matches SWEEP_GAS_SUN below

// A real account xprv (m/44'/195'/0') so deriveDepositPrivateKey actually runs.
const ACCOUNT_XPRV = HDKey.fromMasterSeed(sha256('sweep-test-seed')).derive("m/44'/195'/0'").privateExtendedKey;

interface FakeChain {
  chain: SweepChain;
  drips: { to: string; sun: bigint }[];
  sweeps: { priv: string; to: string; units: bigint }[];
}
function fakeChain(usdt: Record<string, bigint>, trx: Record<string, bigint>): FakeChain {
  const drips: FakeChain['drips'] = [];
  const sweeps: FakeChain['sweeps'] = [];
  return {
    drips,
    sweeps,
    chain: {
      usdtBalanceUnits: async (a): Promise<bigint> => usdt[a] ?? 0n,
      trxBalanceSun: async (a): Promise<bigint> => trx[a] ?? 0n,
      dripGas: async (to, sun): Promise<string> => {
        drips.push({ to, sun });
        return 'gas-tx';
      },
      sweepUsdt: async (priv, to, units): Promise<string> => {
        sweeps.push({ priv, to, units });
        return 'sweep-tx';
      },
    },
  };
}

const seed = (index: number, address: string): Promise<unknown> =>
  DepositAddressModel.create({ _id: `player-${index}`, index, address });

beforeAll(async () => {
  await startTestDb();
  process.env.TRON_ACCOUNT_XPRV = ACCOUNT_XPRV;
  process.env.TREASURY_SWEEP_ADDRESS = TREASURY;
  process.env.SWEEP_MIN_USDT = '1';
  process.env.SWEEP_GAS_SUN = '30000000';
  process.env.SWEEP_COOLDOWN_MS = '300000';
});
afterAll(async () => {
  for (const k of ['TRON_ACCOUNT_XPRV', 'TREASURY_SWEEP_ADDRESS', 'SWEEP_MIN_USDT', 'SWEEP_GAS_SUN', 'SWEEP_COOLDOWN_MS']) {
    delete process.env[k];
  }
  await stopTestDb();
});
afterEach(clearCollections);

describe('sweep', () => {
  it('sweeps the full balance of a funded, gassed address to the treasury', async () => {
    await seed(1, ADDR);
    const f = fakeChain({ [ADDR]: 10_000_000n }, { [ADDR]: 100_000_000n }); // 10 USDT, 100 TRX
    const r = await sweepOnce(f.chain);

    expect(r).toEqual({ scanned: 1, gassed: 0, swept: 1 });
    expect(f.drips).toHaveLength(0);
    expect(f.sweeps).toEqual([
      { priv: deriveDepositPrivateKey(ACCOUNT_XPRV, 1), to: TREASURY, units: 10_000_000n },
    ]);
    const state = await SweepStateModel.findById(ADDR).lean();
    expect(state?.lastAction).toBe('sweep');
  });

  it('gasses an address that has USDT but no TRX, and does not sweep yet', async () => {
    await seed(1, ADDR);
    const f = fakeChain({ [ADDR]: 10_000_000n }, { [ADDR]: 0n });
    const r = await sweepOnce(f.chain);

    expect(r).toEqual({ scanned: 1, gassed: 1, swept: 0 });
    expect(f.drips).toEqual([{ to: ADDR, sun: GAS_SUN }]);
    expect(f.sweeps).toHaveLength(0);
    const state = await SweepStateModel.findById(ADDR).lean();
    expect(state?.lastAction).toBe('gas');
  });

  it('skips dust below the minimum', async () => {
    await seed(1, ADDR);
    const f = fakeChain({ [ADDR]: 500_000n }, { [ADDR]: 100_000_000n }); // 0.5 USDT < 1
    const r = await sweepOnce(f.chain);

    expect(r).toEqual({ scanned: 1, gassed: 0, swept: 0 });
    expect(f.drips).toHaveLength(0);
    expect(f.sweeps).toHaveLength(0);
  });

  it('respects the per-address cooldown, then acts once it elapses', async () => {
    await seed(1, ADDR);
    const base = new Date('2026-01-01T00:00:00Z');
    await SweepStateModel.create({ _id: ADDR, lastAction: 'gas', lastTxHash: 'g', lastActionAt: base });

    const funded = fakeChain({ [ADDR]: 10_000_000n }, { [ADDR]: 100_000_000n });
    // 1 minute later — inside the 5-minute cooldown → nothing happens.
    const within = await sweepOnce(funded.chain, new Date(base.getTime() + 60_000));
    expect(within).toEqual({ scanned: 1, gassed: 0, swept: 0 });
    expect(funded.sweeps).toHaveLength(0);

    // 6 minutes later — cooldown elapsed → it sweeps.
    const after = await sweepOnce(funded.chain, new Date(base.getTime() + 360_000));
    expect(after.swept).toBe(1);
    expect(funded.sweeps).toHaveLength(1);
  });

  it('does nothing when sweeping is not configured', async () => {
    delete process.env.TREASURY_SWEEP_ADDRESS;
    await seed(1, ADDR);
    const f = fakeChain({ [ADDR]: 10_000_000n }, { [ADDR]: 100_000_000n });
    const r = await sweepOnce(f.chain);
    expect(r).toEqual({ scanned: 0, gassed: 0, swept: 0 });
    expect(f.sweeps).toHaveLength(0);
    process.env.TREASURY_SWEEP_ADDRESS = TREASURY;
  });
});
