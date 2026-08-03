import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment configuration — loaded once at startup, validated, fail-fast.
 *
 * Reads `.env` (via dotenv) then validates `process.env`. Missing/invalid required values throw a
 * clear, actionable error instead of the service starting in a half-configured, unsafe state.
 * Security-critical secrets (internal API secret, JWT secret) are REQUIRED — the service refuses to
 * boot without them rather than run wide open.
 */

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  // 0 = OS-assigned ephemeral port (valid for Node's listen); real deploys set a fixed port.
  PORT: z.coerce.number().int().min(0).max(65535).default(4001),
  LOG_LEVEL: z.string().default('info'),

  // MongoDB MUST be a replica set (transactions). e.g. mongodb://host:27017/db?replicaSet=rs0
  MONGO_URI: z.string().min(1, 'MONGO_URI is required (a replica-set connection string)'),
  MONGO_TLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Service-to-service + player auth secrets. Required — no insecure defaults.
  INTERNAL_API_SECRET: z.string().min(8, 'INTERNAL_API_SECRET must be set (≥8 chars)'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be set (≥8 chars)'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(): AppConfig {
  // Populates process.env from .env without overwriting already-set vars.
  dotenv.config();

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Copy financial-core/.env.example to financial-core/.env and fill the required values.',
    );
  }
  return parsed.data;
}
