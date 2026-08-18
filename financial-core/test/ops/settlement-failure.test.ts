import { recordSettlementFailure } from '../../src/ops/security-events';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { setAlertHandler, resetAlertHandler, type AlertContext } from '../../src/lib/alert';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * A settlement failure reported by the game-server must become a DURABLE, PAGED signal — the point of
 * routing abandonRound through here rather than leaving it a console line on the game node.
 */
describe('recordSettlementFailure — a money fault reaches the security log + ops', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(SecurityLogModel);
  });
  afterAll(stopTestDb);
  afterEach(async () => {
    resetAlertHandler();
    await clearCollections();
  });

  it('writes an append-only SETTLEMENT_FAILURE entry and pages ops with the table + round', async () => {
    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });

    await recordSettlementFailure('table-9', 'ledger refused: not conserved', 'round-42');

    const rows = await SecurityLogModel.find({ event: 'SETTLEMENT_FAILURE' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({
      tableId: 'table-9',
      roundId: 'round-42',
      reason: 'ledger refused: not conserved',
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain('table-9');
    expect(alerts[0]!.message).toContain('round-42');
    expect(alerts[0]!.context).toMatchObject({ tableId: 'table-9', roundId: 'round-42' });
  });

  it('reports without a roundId when the caller does not have one', async () => {
    const alerts: string[] = [];
    setAlertHandler((message) => {
      alerts.push(message);
    });

    await recordSettlementFailure('table-x', 'jackpot pool failed to open');

    const rows = await SecurityLogModel.find({ event: 'SETTLEMENT_FAILURE' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ tableId: 'table-x', reason: 'jackpot pool failed to open' });
    expect(alerts[0]).toContain('table-x');
  });
});
