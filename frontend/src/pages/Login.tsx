import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, ChevronLeft, User, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSession, unconfirmedEmailFrom } from '@/store/session';
import { GoogleAuthButton } from '@/components/GoogleAuthButton';

/** Digits in a confirmation code. Must match OTP_LENGTH on the gateway. */
const CODE_LENGTH = 6;

/** Must match MIN_PASSWORD_LENGTH on the gateway, and `auth.passwordTooShort`. */
const MIN_PASSWORD_LENGTH = 8;

/** Seconds until `iso`, floored at zero. Zero for a missing or past date. */
function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
}

export function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { signInWithEmail, signUpWithEmail, confirmEmail, resendCode } = useSession();

  const [view, setView] = useState<'initial' | 'login' | 'signup' | 'confirm'>('initial');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The confirmation step. `pendingEmail` is the server's normalised spelling,
  // not what was typed — the challenge is keyed on the former.
  const [pendingEmail, setPendingEmail] = useState('');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendNote, setResendNote] = useState<string | null>(null);

  /**
   * The real double-submit guard.
   *
   * `isSubmitting` is state, so it only becomes true on the NEXT render: two
   * clicks inside one frame both pass it. That is docs/TRAPS.md #14, where the
   * same shape filed two genuine withdrawal requests. A ref is set before any
   * await, so the second click sees it immediately. It matters here because a
   * duplicate confirm spends the code on the first request and shows the second
   * an alarming "no confirmation is pending" — for a sign-up that worked.
   *
   * Cleared in a finally, never only on success, or a failure locks the form.
   */
  const inFlight = useRef(false);

  // Tick the resend countdown. Derived from the server's timestamp rather than
  // counted down locally, so a backgrounded tab comes back to the right number
  // instead of one frozen where it left off.
  useEffect(() => {
    if (!resendAt) return;
    const tick = (): void => setResendSeconds(secondsUntil(resendAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [resendAt]);

  const enterConfirm = (email: string, nextResendAt: string | null): void => {
    setPendingEmail(email);
    setResendAt(nextResendAt);
    setResendSeconds(secondsUntil(nextResendAt));
    setCode('');
    setResendNote(null);
    setView('confirm');
  };

  const handleAuth = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setIsSubmitting(true);

    try {
      if (view === 'login') {
        await signInWithEmail(identifier, password);
        navigate('/');
      } else {
        // Sign-up mints NO session. It returns a pending confirmation, and the
        // only way on from here is the code screen.
        const pending = await signUpWithEmail(identifier, password, displayName);
        enterConfirm(pending.email, pending.resendAvailableAt);
      }
    } catch (err) {
      // The store has already shown the message. What is left to decide is
      // where the player goes: an unconfirmed account is not a failed sign-in,
      // it is a sign-up that was never finished, and the gateway has just
      // mailed a fresh code for it.
      const unconfirmed = unconfirmedEmailFrom(err);
      if (unconfirmed) {
        const body = (err as { body?: { resendAvailableAt?: string; sent?: boolean } }).body;
        enterConfirm(unconfirmed, body?.resendAvailableAt ?? null);
        if (body?.sent === false) setResendNote(t('auth.confirmResendUnavailable'));
      }
      // Anything else stays on this form with the toast the store raised.
      // Swallowed deliberately: this handler is the top of the chain, and
      // rethrowing here is an unhandled rejection and nothing more.
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setIsSubmitting(true);

    try {
      await confirmEmail(pendingEmail, code);
      navigate('/');
    } catch {
      // Wrong, expired, or spent — the store toasted the server's own wording,
      // which distinguishes those three. Clear the field so the next attempt
      // starts from empty rather than from six wrong digits.
      setCode('');
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const handleResend = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setResendNote(null);
    try {
      const pending = await resendCode(pendingEmail);
      setResendAt(pending.resendAvailableAt);
      setResendSeconds(secondsUntil(pending.resendAvailableAt));
    } catch (err) {
      // A 429 carries the server's own countdown; adopt it rather than guessing.
      const retryAfterMs = (err as { body?: { retryAfterMs?: number } }).body?.retryAfterMs;
      if (typeof retryAfterMs === 'number') {
        const until = new Date(Date.now() + retryAfterMs).toISOString();
        setResendAt(until);
        setResendSeconds(secondsUntil(until));
      }
    } finally {
      inFlight.current = false;
    }
  };

  const codeComplete = code.length === CODE_LENGTH;

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="px-5 pt-8 pb-2 text-center">
            <img
              src="/brand/logo.png"
              alt="MyPoker"
              className="mx-auto mb-2 h-20 w-auto object-contain drop-shadow-2xl"
            />
            <h1 className="text-xl font-bold text-text">MYPOKER</h1>
            <p className="mt-1 text-xs text-dim">
              {view === 'confirm'
                ? t('auth.confirmTitle')
                : view === 'signup'
                  ? t('auth.createAccount')
                  : view === 'login'
                    ? t('auth.signIn')
                    : t('auth.subtitle')}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {view === 'initial' && (
              <motion.div
                key="initial"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col gap-3.5 p-5"
              >
                {/* Google Sign-In */}
                <GoogleAuthButton full />

                <div className="relative my-1 text-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <span className="relative bg-surface px-3 text-xs font-semibold text-dim">
                    {t('auth.or')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setView('login')}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-black/20 p-3.5 transition-colors hover:bg-border/40 active:scale-[0.98]"
                  >
                    <Mail size={20} className="text-brand" />
                    <span className="text-xs font-bold text-text">{t('auth.signIn')}</span>
                  </button>
                  <button
                    onClick={() => setView('signup')}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-black/20 p-3.5 transition-colors hover:bg-border/40 active:scale-[0.98]"
                  >
                    <User size={20} className="text-brand" />
                    <span className="text-xs font-bold text-text">{t('auth.createAccount')}</span>
                  </button>
                </div>
              </motion.div>
            )}

            {(view === 'login' || view === 'signup') && (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col p-5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center">
                    <button
                      onClick={() => setView('initial')}
                      className="mr-3 grid size-8 place-items-center rounded-full bg-border/40 text-dim transition-colors hover:bg-border/80 hover:text-text"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <h2 className="text-base font-bold text-text">
                      {view === 'login' ? t('auth.signIn') : t('auth.createAccount')}
                    </h2>
                  </div>

                  {/* The Email/Phone toggle is gone. It changed the label, the
                      icon and the placeholder — and then asked for a PASSWORD.
                      Nobody who taps "Phone" expects to invent a password; they
                      expect an SMS code, and there is no OTP flow behind it.

                      Removed rather than built, per SAMUEL.md's "either build
                      the real OTP flow or remove the phone option so nothing
                      misleads a user": real OTP needs an SMS provider, which is
                      an owner dependency nobody has arranged.

                      Email confirmation, which now gates every sign-up, is a
                      different thing and does NOT bring the toggle back. The
                      gateway refuses a phone sign-up outright for exactly the
                      reason above: no SMS provider means no way to confirm it,
                      and the account would be created unusable. Phone sign-IN
                      still works for accounts that predate this. */}
                </div>

                <form onSubmit={handleAuth} className="flex flex-col gap-3.5">
                  {view === 'signup' && (
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-dim ml-1">
                        {t('auth.displayName')}
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                          <User size={16} />
                        </div>
                        <input
                          type="text"
                          required
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="h-11 w-full rounded-xl border border-border bg-black/40 pl-10 pr-4 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                          placeholder="Your Player Name"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-dim ml-1">{t('auth.email')}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                        <Mail size={16} />
                      </div>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="h-11 w-full rounded-xl border border-border bg-black/40 pl-10 pr-4 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-dim ml-1">
                      {t('auth.password')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                        <Lock size={16} />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        // Sign-up only. The server enforces this either way
                        // (credential-rules.ts) — this just saves a round trip
                        // to learn it. On SIGN-IN there must be no minimum, or
                        // accounts created before the rule existed could not
                        // type their own password.
                        {...(view === 'signup' ? { minLength: MIN_PASSWORD_LENGTH } : {})}
                        autoComplete={view === 'login' ? 'current-password' : 'new-password'}
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

                  <div className="mt-2">
                    <Button full disabled={isSubmitting}>
                      {isSubmitting
                        ? view === 'login'
                          ? `${t('auth.signIn')}…`
                          : `${t('auth.createAccount')}…`
                        : view === 'login'
                          ? t('auth.signIn')
                          : t('auth.createAccount')}
                    </Button>
                  </div>
                </form>
              </motion.div>
            )}

            {view === 'confirm' && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col p-5"
              >
                <div className="mb-4 flex items-center">
                  <button
                    onClick={() => setView('initial')}
                    className="mr-3 grid size-8 place-items-center rounded-full bg-border/40 text-dim transition-colors hover:bg-border/80 hover:text-text"
                    aria-label={t('auth.confirmBack')}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <h2 className="text-base font-bold text-text">{t('auth.confirmTitle')}</h2>
                </div>

                <p className="mb-4 text-xs leading-relaxed text-dim">
                  {t('auth.confirmSubtitle', { email: pendingEmail })}
                </p>

                <form onSubmit={handleConfirm} className="flex flex-col gap-3.5">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-dim ml-1" htmlFor="otp">
                      {t('auth.confirmCode')}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                        <ShieldCheck size={16} />
                      </div>
                      <input
                        id="otp"
                        type="text"
                        required
                        // `one-time-code` is what lets iOS and Android offer the
                        // code from the notification, and inputMode gives a
                        // numeric keypad without type="number"'s spinner and
                        // silent leading-zero stripping — a real hazard when
                        // "042318" is a valid code.
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="\d*"
                        maxLength={CODE_LENGTH}
                        autoFocus
                        value={code}
                        onChange={(e) =>
                          setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                        }
                        className="h-11 w-full rounded-xl border border-border bg-black/40 pl-10 pr-4 text-center font-mono text-lg tracking-[0.4em] text-text placeholder:tracking-normal placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                        placeholder="000000"
                      />
                    </div>
                  </div>

                  <div className="mt-1">
                    <Button full disabled={isSubmitting || !codeComplete}>
                      {isSubmitting ? t('auth.confirming') : t('auth.confirmButton')}
                    </Button>
                  </div>
                </form>

                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => void handleResend()}
                    disabled={resendSeconds > 0}
                    className="text-xs font-semibold text-accent transition-colors hover:text-text disabled:cursor-not-allowed disabled:text-dim"
                  >
                    {resendSeconds > 0
                      ? t('auth.confirmResendIn', { seconds: resendSeconds })
                      : t('auth.confirmResend')}
                  </button>
                  {resendNote && <p className="mt-2 text-xs text-dim">{resendNote}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
