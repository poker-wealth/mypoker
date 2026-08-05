/**
 * Gateway entrypoint.
 *
 *   npm run gateway
 *
 * Reads .env, boots the HTTP app, and reports what it's configured with — the
 * summary is deliberately printed because a gateway that starts with no bot token
 * or with the dev bypass on is a thing you want to notice immediately.
 */
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from './config';
import { createGatewayApp } from './app';
import { seedLobby } from '../lobby';

loadDotenv();

const config = loadConfig();
const app = createGatewayApp(config, seedLobby());

app.listen(config.port, () => {
  console.log(`\n  FairPlay gateway — http://localhost:${config.port}\n`);
  console.log(`  telegram login   ${config.botToken ? 'enabled' : 'DISABLED (no bot token)'}`);
  console.log(`  dev bypass       ${config.devAuthBypass ? 'ON — do not deploy this' : 'off'}`);
  console.log(`  financial core   ${config.financialCoreUrl}`);
  console.log(`  cors origins     ${config.corsOrigins.join(', ') || '(none — same-origin only)'}\n`);
});
