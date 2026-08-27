import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/store/session';
import { ApiError } from '@/api/client';

/**
 * Admin sign-in — the gate on the admin host.
 *
 * Google OR email + password. NO sign-up: an administrator is created by another
 * administrator (the Admins screen) or seeded, never self-registered here — so a
 * "create account" option would only mislead. Both flows go through the session's
 * admin sign-in, which refuses anything that is not an `ops` account: a valid
 * player credential lands back here with a clear message, never a half-signed-in
 * player session.
 */
export function AdminLogin() {
  const { signInAsAdmin, signInWithGoogleAsAdmin, status } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = submitting || status === 'authenticating';

  const asMessage = (err: unknown): string =>
    err instanceof ApiError ? err.message : 'Sign in failed. Please try again.';

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      if (!tokenResponse.access_token) return;
      setError(null);
      try {
        await signInWithGoogleAsAdmin(tokenResponse.access_token);
      } catch (err) {
        setError(asMessage(err));
      }
    },
    onError: () => setError('Google sign-in failed. Please try again.'),
  });

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInAsAdmin(email.trim(), password);
      // On success the AdminShell gate re-renders straight to the panel.
    } catch (err) {
      setError(asMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="px-6 pt-8 pb-2 text-center">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-brand/15 text-brand">
              <ShieldCheck size={24} />
            </div>
            <h1 className="text-lg font-bold text-text">MYPOKER Admin</h1>
            <p className="mt-1 text-xs text-dim">Administrator sign-in</p>
          </div>

          <div className="flex flex-col gap-3.5 p-6">
            {/* Google */}
            <Button
              full
              variant="secondary"
              disabled={busy}
              onClick={() => googleLogin()}
              className="flex items-center justify-center gap-2 border-border bg-surface py-2.5 font-medium text-text hover:bg-surface-2"
            >
              {status === 'authenticating' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
              )}
              Continue with Google
            </Button>

            <div className="relative text-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <span className="relative bg-surface px-3 text-xs font-semibold text-dim">OR</span>
            </div>

            {/* Email + password */}
            <form onSubmit={submit} className="flex flex-col gap-3.5">
              <div className="space-y-1">
                <label className="ml-1 text-xs font-semibold text-dim">Email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                    <Mail size={16} />
                  </div>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-black/40 pl-10 pr-4 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    placeholder="admin@mypoker777.com"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="ml-1 text-xs font-semibold text-dim">Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                    <Lock size={16} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-black/40 pl-10 pr-10 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-dim hover:text-text"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </div>
              )}

              <Button full disabled={busy} className="mt-1">
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </div>
        </div>

        <p className="mt-4 text-center text-[0.66rem] text-dim">
          Restricted area. Every action here is attributed to your account.
        </p>
      </div>
    </div>
  );
}
