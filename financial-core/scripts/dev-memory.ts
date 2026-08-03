/**
 * Live dev server on an in-memory MongoDB replica set (zero install). Start it, then poke the API
 * yourself with the printed PowerShell commands.
 *
 *   npm run dev:memory
 *
 * Ctrl+C to stop. Data is in-memory and discarded on exit.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../src/db/connection';
import { createApp } from '../src/http/app';
import { signToken } from '../src/http/jwt';
import { AccountModel } from '../src/wallet/account.model';
import { AccountType } from '../src/domain/account-types';
import { OFFICIAL_USDT_TRC20_CONTRACT } from '../src/deposit/trc20';

const INTERNAL = 'dev-internal-secret';
const JWT = 'dev-jwt-secret';
const PORT = Number(process.env.PORT ?? 4001);

async function main(): Promise<void> {
  process.env.INTERNAL_API_SECRET = INTERNAL;
  process.env.JWT_SECRET = JWT;

  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDb({ uri: rs.getUri('fc_dev') });
  await AccountModel.init();
  await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });

  const app = createApp();
  const server = app.listen(PORT);
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const token = signToken({ playerId: 'p-demo', role: 'player' }, JWT, 86_400);

  console.log(`\n\x1b[1mFairPlay Financial Core — dev server up\x1b[0m  ${base}`);
  console.log(`(in-memory DB; Ctrl+C to stop)\n`);
  console.log('Copy-paste into PowerShell:\n');
  console.log(`$base = '${base}'`);
  console.log(`$tok  = '${token}'`);
  console.log(`$sec  = '${INTERNAL}'`);
  console.log(`$off  = '${OFFICIAL_USDT_TRC20_CONTRACT}'`);
  console.log('');
  console.log('# health');
  console.log('Invoke-RestMethod "$base/health"');
  console.log('');
  console.log('# OpenAPI docs');
  console.log('Invoke-RestMethod "$base/openapi.json" | ConvertTo-Json -Depth 6');
  console.log('');
  console.log('# deposit 500 (official contract, 20 confirmations)');
  console.log(
    'Invoke-RestMethod -Method Post "$base/internal/deposits" -Headers @{ \'x-internal-secret\'=$sec } ' +
      "-ContentType 'application/json' -Body (@{ playerId='p-demo'; amount='500'; txHash='tx1'; contractAddress=$off; confirmations=20 } | ConvertTo-Json)",
  );
  console.log('');
  console.log('# balance (player token)');
  console.log('Invoke-RestMethod "$base/me/balance" -Headers @{ Authorization = "Bearer $tok" }');
  console.log('');
  console.log('# try a non-official contract deposit → NOT credited');
  console.log(
    'Invoke-RestMethod -Method Post "$base/internal/deposits" -Headers @{ \'x-internal-secret\'=$sec } ' +
      "-ContentType 'application/json' -Body (@{ playerId='p-demo'; amount='999'; txHash='txbad'; contractAddress='TXfake'; confirmations=20 } | ConvertTo-Json)",
  );
  console.log('');
  console.log('# request a withdrawal');
  console.log(
    'Invoke-RestMethod -Method Post "$base/me/withdrawals" -Headers @{ Authorization="Bearer $tok" } ' +
      "-ContentType 'application/json' -Body (@{ amount='200'; address='TXaddr' } | ConvertTo-Json)",
  );
  console.log('');
  console.log('# no token → 401 (try it: this should error)');
  console.log('Invoke-RestMethod "$base/me/balance"');
  console.log('');

  const shutdown = async (): Promise<void> => {
    console.log('\nshutting down…');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDb();
    await rs.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
