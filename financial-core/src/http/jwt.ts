import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT sign/verify for player-scoped API tokens.
 *
 * Kept dependency-free and small on purpose — the Financial Core only needs to verify a short-lived
 * scope token (playerId / leagueId / role) issued by the auth service. Signature compare is
 * timing-safe; `exp` is enforced.
 */

export interface TokenClaims {
  playerId: string;
  /** Present only for league-scoped principals. */
  leagueId?: string;
  role?: 'player' | 'league_admin' | 'ops';
  iat?: number;
  exp?: number;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function signToken(
  claims: Omit<TokenClaims, 'iat' | 'exp'>,
  secret: string,
  expiresInSec = 3600,
): string {
  const iat = nowSec();
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({ ...claims, iat, exp: iat + expiresInSec });
  const data = `${header}.${payload}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export class TokenError extends Error {}

export function verifyToken(token: string, secret: string): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('malformed token');
  const [header, payload, sig] = parts as [string, string, string];

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new TokenError('bad signature');
  }

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
  } catch {
    throw new TokenError('unparseable payload');
  }
  if (claims.exp !== undefined && claims.exp < nowSec()) {
    throw new TokenError('token expired');
  }
  if (!claims.playerId) throw new TokenError('missing playerId claim');
  return claims;
}
