/**
 * Gateway configuration, read from the environment once at startup.
 *
 * Anything security-relevant is validated here rather than at the point of use,
 * so a misconfigured deploy fails loudly on boot instead of silently letting
 * requests through later.
 */

export interface GatewayConfig {
  port: number;
  botToken: string;
  initDataMaxAgeSeconds: number;
  jwtSecret: string;
  jwtTtlSeconds: number;
  devAuthBypass: boolean;
  financialCoreUrl: string;
  internalApiSecret: string;
  corsOrigins: string[];
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const isProduction = env.NODE_ENV === 'production';
  const devAuthBypass = env.DEV_AUTH_BYPASS === 'true' && !isProduction;

  const config: GatewayConfig = {
    port: num(env.PORT, 4100),
    botToken: env.TELEGRAM_BOT_TOKEN ?? '',
    initDataMaxAgeSeconds: num(env.TELEGRAM_INITDATA_MAX_AGE_SECONDS, 86_400),
    jwtSecret: env.JWT_SECRET ?? '',
    jwtTtlSeconds: num(env.JWT_TTL_SECONDS, 86_400),
    devAuthBypass,
    financialCoreUrl: (env.FINANCIAL_CORE_URL ?? 'http://localhost:4001').replace(/\/$/, ''),
    internalApiSecret: env.INTERNAL_API_SECRET ?? '',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };

  // A missing JWT secret would mean signing with '' — every token forgeable.
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET is required (it must match the Financial Core exactly)');
  }
  if (isProduction && !config.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required in production');
  }
  if (env.DEV_AUTH_BYPASS === 'true' && isProduction) {
    throw new Error('DEV_AUTH_BYPASS cannot be enabled in production');
  }

  return config;
}
