import { config as loadDotenv } from 'dotenv';
import { startFromEnv } from '../src/live/server';

/**
 * Local runner for the live tables:  npm run tables
 *
 * The server itself is `src/live/server.ts` so it can be compiled and deployed — see the note
 * there. This file only loads `.env` (which the deployed platform provides through its own config)
 * and starts it.
 */

loadDotenv();
startFromEnv();
