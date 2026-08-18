import { useState, lazy, Suspense, memo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, ArrowRight, AlertCircle, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/auth';
import orbitLogo from '../assets/pdf/logo.png';
import { useDarkMode } from '../hooks/useDarkMode';

const BlackHoleHero = lazy(() => import('../components/BlackHoleHero'));

const OrbitLogo = memo(function OrbitLogo({ className = "", darkMode = true }: { className?: string; darkMode?: boolean }) {
    return (
        <div className={`flex items-center gap-3 ${className}`}>
            <img
                src={orbitLogo}
                alt="Orbit Logo"
                width={792}
                height={296}
                className="h-auto w-32 object-contain sm:w-36 lg:w-40"
                style={{ filter: darkMode ? 'none' : 'invert(1)' }}
            />
        </div>
    );
});

export default function Login() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { login } = useAuth();

    const [darkMode, setDarkMode] = useDarkMode();

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const email = String(formData.get('email') ?? '');
        const password = String(formData.get('password') ?? '');

        setError('');
        setLoading(true);

        const result = await login(email, password);

        if (result.success) {
            navigate({ to: '/' });
        } else {
            setError(result.error || 'Login failed');
        }

        setLoading(false);
    };

    return (
        <div
            className="blackhole-interaction-shell min-h-screen w-full flex flex-col lg:flex-row text-[var(--text-primary)]"
        >

            {/* Theme Toggle — top right corner */}
            <button
                onClick={() => setDarkMode(prev => !prev)}
                className="absolute top-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
                {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* Left Side: Lazy Loaded Black Hole Hero */}
            <div className="relative flex h-[280px] w-full shrink-0 flex-col sm:h-[320px] lg:h-auto lg:min-h-screen lg:w-3/5 lg:shrink">
                <Suspense fallback={<div className="h-full w-full flex-1 bg-transparent" />}>
                    <BlackHoleHero
                        contentClassName="pt-14 sm:pt-16 lg:pt-0"
                        className="h-full w-full flex-1 overflow-hidden"
                    />
                </Suspense>

                <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 sm:top-8 lg:hidden">
                    <OrbitLogo darkMode={darkMode} />
                </div>
            </div>

            {/* Right Side: Login Form */}
            <div className="w-full lg:w-2/5 flex flex-1 items-center justify-center p-6 sm:p-8 lg:p-12 shrink-0 lg:shrink">
                <div className="w-full max-w-sm mx-auto text-center lg:text-left">
                    <div className="mb-10 hidden justify-center lg:flex">
                        <OrbitLogo darkMode={darkMode} />
                    </div>

                    <div className="mb-6 sm:mb-8">
                        <h1 className="text-xl sm:text-2xl font-medium tracking-tight mb-2 font-display text-[var(--text-primary)]">
                            Access Control
                        </h1>
                        <p className="text-sm text-[var(--text-muted)]">
                            Please authenticate to continue.
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-4 text-left sm:space-y-5">
                        <div className="space-y-1.5">
                            <label
                                htmlFor="login-email"
                                className="text-[10px] uppercase font-bold tracking-widest text-[var(--text-muted)]"
                            >
                                Email Address
                            </label>
                            <input
                                id="login-email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                disabled={loading}
                                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors duration-200 border border-[var(--border)] focus:border-[var(--accent)] bg-[var(--bg-card)] text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="name@company.com"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label
                                htmlFor="login-password"
                                className="text-[10px] uppercase font-bold tracking-widest text-[var(--text-muted)]"
                            >
                                Password
                            </label>
                            <input
                                id="login-password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                disabled={loading}
                                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors duration-200 border border-[var(--border)] focus:border-[var(--accent)] bg-[var(--bg-card)] text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="••••••••"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] py-3.5 text-xs font-bold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(196,163,90,0.2)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0a0a0a]"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : <>Sign In <ArrowRight size={16} /></>}
                        </button>
                    </form>

                    <div className="mt-8 flex items-center justify-between border-t border-[var(--border)] pt-6 text-[9px] uppercase tracking-wider text-[var(--text-muted)] sm:mt-10 sm:text-[10px]">
                        <span>Orbit System v2.0</span>
                        <span>Secure Connection</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
