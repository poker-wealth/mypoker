import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, ChevronLeft, User, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/store/session';
import { GoogleAuthButton } from '@/components/GoogleAuthButton';

export function Login() {
  const navigate = useNavigate();
  const { signInWithEmail, signUpWithEmail } = useSession();
  
  const [view, setView] = useState<'initial' | 'login' | 'signup'>('initial');
  
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      if (view === 'login') {
        await signInWithEmail(identifier, password);
      } else {
        await signUpWithEmail(identifier, password, displayName);
      }
      navigate('/');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4" style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}>
      
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
              {view === 'signup' ? 'Create an account to play' : view === 'login' ? 'Sign in with your account' : 'Sign up or log in to get started'}
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
                  <span className="relative bg-surface px-3 text-xs font-semibold text-dim">OR</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setView('login')}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-black/20 p-3.5 transition-colors hover:bg-border/40 active:scale-[0.98]"
                  >
                    <Mail size={20} className="text-brand" />
                    <span className="text-xs font-bold text-text">Sign In</span>
                  </button>
                  <button
                    onClick={() => setView('signup')}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-black/20 p-3.5 transition-colors hover:bg-border/40 active:scale-[0.98]"
                  >
                    <User size={20} className="text-brand" />
                    <span className="text-xs font-bold text-text">Sign Up</span>
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
                      {view === 'login' ? 'Sign In' : 'Create Account'}
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

                      The backend still matches on phone (auth/user-store.ts), so
                      when OTP is funded this comes back as a real second method
                      rather than a relabelled first one. */}
                </div>

                <form onSubmit={handleAuth} className="flex flex-col gap-3.5">
                  
                  {view === 'signup' && (
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-dim ml-1">Display Name</label>
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
                    <label className="text-xs font-semibold text-dim ml-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                        <Mail size={16} />
                      </div>
                      <input
                        type="email"
                        required
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="h-11 w-full rounded-xl border border-border bg-black/40 pl-10 pr-4 text-sm text-text placeholder:text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-dim ml-1">Password</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                        <Lock size={16} />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
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
                    <Button 
                      full 
                      disabled={isSubmitting}
                    >
                      {isSubmitting 
                        ? (view === 'login' ? 'Signing In...' : 'Creating Account...') 
                        : (view === 'login' ? 'Sign In' : 'Create Account')}
                    </Button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
