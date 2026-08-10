import type { PlayerProfile } from '../gateway/auth';

interface AuthClientConfig {
  financialCoreUrl: string;
  internalSecret: string;
}

export class AuthClient {
  constructor(private readonly config: AuthClientConfig) {}

  async signup(email: string, passwordPlain: string, displayName?: string): Promise<PlayerProfile> {
    return this.post<PlayerProfile>('/internal/auth/signup', { email, password: passwordPlain, displayName });
  }

  async verifyPassword(email: string, passwordPlain: string): Promise<PlayerProfile> {
    return this.post<PlayerProfile>('/internal/auth/verify-password', { email, password: passwordPlain });
  }

  async oauth(googleId: string, email: string, displayName?: string, photoUrl?: string): Promise<PlayerProfile> {
    return this.post<PlayerProfile>('/internal/auth/oauth', { googleId, email, displayName, photoUrl });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.config.financialCoreUrl}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // financial-core's internalAuth reads the shared secret from this
        // header (see its http/middleware.ts), same as financial-core-client.
        'x-internal-secret': this.config.internalSecret,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;

    if (!res.ok) {
      throw new Error(data?.error ?? `Auth service returned ${res.status}`);
    }

    return data as T;
  }
}
