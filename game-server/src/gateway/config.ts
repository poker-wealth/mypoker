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
  /** The gateway's own database (identity/user store). */
  mongoUri: string;
  mongoTls: boolean;
  /**
   * How many reverse-proxy hops to trust in front of this process — Express's
   * `trust proxy` setting (see `app.ts`). Without it `req.ip` is whichever hop
   * sits directly in front of the process for EVERY request, not the real
   * client: on Heroku that is the platform router, so `req.ip` was constant
   * across every visitor and the login throttle's IP half (BUG-15) added no
   * protection at all (see auth.ts).
   *
   * Heroku's router is exactly one hop and always appends the true client
   * address as the RIGHTMOST entry of `X-Forwarded-For` — it does not forward
   * whatever a client already put there, it adds to it — so trusting exactly
   * one hop reads the real client and nothing a client could have spoofed by
   * sending its own `X-Forwarded-For`. Trusting more hops than actually exist
   * in front of the process is what makes `X-Forwarded-For` attacker-spoofable
   * (Express then reads further left, into what the client itself sent).
   *
   * Defaults to 1 in production (Heroku) and 0 elsewhere (no proxy in dev/test,
   * so `req.ip` is already the real connecting socket).
   */
  trustProxyHops: number;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Like `num()` but for a hop COUNT, where 0 is a valid, meaningful value (no
 * proxy in front of the process) rather than "unset". `num()` silently maps
 * an explicit `0`, and anything non-numeric or negative, to its fallback —
 * fine for a port or a TTL, wrong here: a production deploy with no proxy in
 * front of it needs `TRUST_PROXY_HOPS=0` to actually mean 0, not silently
 * become 1, and a typo ('abc', '-1') or a fractional hop count ('1.5', which
 * Express would trust while `connectionIp` cannot index a fractional element
 * and the two would disagree about the client's IP) must fail loudly rather
 * than pick a number nobody asked for.
 */
export function nonNegativeInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer (got "${value}")`);
  }
  return parsed;
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
    mongoUri: env.MONGO_URI ?? '',
    mongoTls: env.MONGO_TLS === 'true',
    trustProxyHops: nonNegativeInt('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS, isProduction ? 1 : 0),
  };

  // A missing JWT secret would mean signing with '' — every token forgeable.
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET is required (it must match the Financial Core exactly)');
  }
  // MONGO_URI is validated at connect time (server.ts -> connectDb), not here, so
  // config-only consumers (tests, tooling that never opens the DB) don't need it.
  if (isProduction && !config.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required in production');
  }
  if (env.DEV_AUTH_BYPASS === 'true' && isProduction) {
    throw new Error('DEV_AUTH_BYPASS cannot be enabled in production');
  }

  return config;
}
