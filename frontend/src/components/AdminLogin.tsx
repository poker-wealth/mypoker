import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/store/session';
import { ApiError } from '@/api/client';

/**
 * Admin sign-in — the gate on the admin host.
 *
 * Email + password ONLY. No Google, no sign-up: an administrator is created by
 * another administrator (the Admins screen) or seeded, never self-registered,
 * so offering those here would only mislead. `signInAsAdmin` refuses anything
 * that is not an `ops` account, so a valid player credential still lands back
 * here with a clear message rather than a half-signed-in player session.
 */
export function AdminLogin() {
  const { signInAsAdmin } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInAsAdmin(email.trim(), password);
      // On success the AdminShell gate re-renders straight to the panel.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Please try again.');
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

          <form onSubmit={submit} className="flex flex-col gap-3.5 p-6">
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

            <Button full disabled={submitting} className="mt-1">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[0.66rem] text-dim">
          Restricted area. Every action here is attributed to your account.
        </p>
      </div>
    </div>
  );
}
