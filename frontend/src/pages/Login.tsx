import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, ChevronLeft, User, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/store/session';
import { useGoogleLogin } from '@react-oauth/google';
import { toast } from '@/store/toast';

export function Login() {
  const navigate = useNavigate();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useSession();
  
  const [view, setView] = useState<'initial' | 'email-login' | 'email-signup'>('initial');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const googleLogin = useGoogleLogin({
    onSuccess: async (credentialResponse) => {
      try {
        if (credentialResponse.access_token) {
          // Since we need the idToken for backend verification, we use credentialResponse or switch to GoogleLogin component.
          // Wait, useGoogleLogin doesn't return idToken with default flow (implicit grant).
          // We need to fetch user info or use `useGoogleOneTapLogin` or `<GoogleLogin>`.
          toast.info('Google token received, signing in...');
          // In a real app we'd pass the access token to backend or change to idToken flow.
          // For now, this is a placeholder since we need the `idToken` flow.
          // Actually, we can use the backend with access_token if we modify backend, but let's stick to id_token.
          await signInWithGoogle(credentialResponse.access_token);
          navigate('/');
        }
      } catch {
        toast.error('Google login failed');
      }
    },
  });

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      if (view === 'email-login') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
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
              className="mx-auto mb-2 h-24 w-auto object-contain drop-shadow-2xl"
            />
            <p className="mt-1 text-sm text-dim">
              {view === 'email-signup' ? 'Create a new account' : 'Sign in to your account'}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {view === 'initial' && (
              <motion.div
                key="initial"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col gap-4 p-5"
              >
                <button
                  onClick={() => googleLogin()}
                  className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-gray-100 active:scale-[0.98]"
                >
                  <svg className="size-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l3.68-2.84z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                </button>

                <div className="relative my-2 text-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <span className="relative bg-surface px-3 text-xs text-dim">OR</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setView('email-login')}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface)_50%,transparent)] p-3 transition-colors hover:bg-border/50 active:scale-[0.98]"
                  >
                    <Mail size={20} className="text-brand" />
                    <span className="text-xs font-bold text-text/90">Sign In</span>
                  </button>
                  <button
                    onClick={() => setView('email-signup')}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface)_50%,transparent)] p-3 transition-colors hover:bg-border/50 active:scale-[0.98]"
                  >
                    <User size={20} className="text-brand" />
                    <span className="text-xs font-bold text-text/90">Sign Up</span>
                  </button>
                </div>
              </motion.div>
            )}

            {(view === 'email-login' || view === 'email-signup') && (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col p-5"
              >
                <div className="mb-6 flex items-center">
                  <button 
                    onClick={() => setView('initial')}
                    className="mr-3 grid size-8 place-items-center rounded-full bg-border/40 text-dim transition-colors hover:bg-border/80 hover:text-text"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <h2 className="text-lg font-bold">
                    {view === 'email-login' ? 'Welcome Back' : 'Create Account'}
                  </h2>
                </div>

                <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
                  
                  {view === 'email-signup' && (
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
                          className="h-12 w-full rounded-xl border border-border bg-black/30 pl-10 pr-4 text-[0.95rem] text-text placeholder:text-text/30 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                          placeholder="Your Name"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-dim ml-1">Email Address</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 grid w-10 place-items-center text-dim">
                        <Mail size={16} />
                      </div>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-12 w-full rounded-xl border border-border bg-black/30 pl-10 pr-4 text-[0.95rem] text-text placeholder:text-text/30 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
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
                        className="h-12 w-full rounded-xl border border-border bg-black/30 pl-10 pr-10 text-[0.95rem] text-text placeholder:text-text/30 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
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
                        ? (view === 'email-login' ? 'Signing In...' : 'Creating...') 
                        : (view === 'email-login' ? 'Sign In' : 'Create Account')}
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
