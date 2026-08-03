import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Player session tokens (HS256 JWT).
 *
 * The gateway is the **issuer** the Financial Core has always been waiting for:
 * `financial-core/src/http/jwt.ts` verifies exactly this shape and says so in its
 * header comment. Both sides must agree on the claim names and the signing
 * algorithm, and both must run with the same `JWT_SECRET` — a mismatch shows up
 * as a 401 on every money call, not as a startup error.
 *
 * This is intentionally a small standalone implementation rather than a shared
 * package: the monorepo has no shared workspace lib, and a signer this size isn't
 * worth inventing one for. If you change the claim shape here, change it there.
 */

export interface TokenClaims {
  playerId: string;
  leagueId?: string;
  role?: 'player' | 'league_admin' | 'ops';
  iat?: number;
  exp?: number;
}

export class TokenError extends Error {}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function signToken(
  claims: Omit<TokenClaims, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number,
): string {
  const iat = nowSeconds();
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({ ...claims, iat, exp: iat + expiresInSeconds });
  const data = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifyToken(token: string, secret: string): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('malformed token');
  const [header, payload, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new TokenError('bad signature');
  }

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
  } catch {
    throw new TokenError('unparseable payload');
  }
  if (claims.exp !== undefined && claims.exp < nowSeconds()) throw new TokenError('token expired');
  if (!claims.playerId) throw new TokenError('missing playerId claim');
  return claims;
}
