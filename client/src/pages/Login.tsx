import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import BlackHoleHero from '../components/BlackHoleHero';
import { useAuth } from '../context/auth';

function OrbitLogo({ className = "" }: { className?: string }) {
    return (
        <div className={`flex items-center gap-3 ${className}`}>
            <img src="/logo.png" alt="Orbit Logo" className="h-10 w-auto" />
        </div>
    );
}

export default function Login() {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { login } = useAuth();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        // Simulate network delay
        await new Promise(r => setTimeout(r, 800));

        const result = await login(email, password);

        if (result.success) {
            navigate({ to: '/' });
        } else {
            setError(result.error || 'Login failed');
        }

        setLoading(false);
    };

    return (
        <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#0a0a0a] text-[var(--text-primary)]">

            {/* Left Side: Black Hole Hero */}
            <div className="w-full lg:w-3/5 relative p-3 sm:p-4 lg:p-8 flex flex-col min-h-[200px] sm:min-h-[280px] lg:min-h-0">
                <BlackHoleHero className="w-full h-full min-h-[180px] sm:min-h-[260px] lg:min-h-full rounded-2xl lg:rounded-3xl overflow-hidden shadow-2xl border border-white/5" />

                {/* Logo overlay on hero (mobile only) */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 lg:hidden">
                    <OrbitLogo />
                </div>
            </div>

            {/* Right Side: Login Form */}
            <div className="w-full lg:w-2/5 flex flex-1 items-center justify-center p-6 sm:p-8 lg:p-12">
                <div className="w-full max-w-sm mx-auto text-center lg:text-left">
                    {/* Logo (desktop only) */}
                    <div className="hidden lg:block mb-10">
                        <OrbitLogo />
                    </div>

                    <div className="mb-6 sm:mb-8">
                        <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                            Access Control
                        </h1>
                        <p className="text-neutral-500 text-sm">Please authenticate to continue.</p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5 text-left">
                        <div className="space-y-1.5">
                            <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-widest">Email Address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                className="w-full bg-[#111] border border-neutral-800 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[#c4a35a] outline-none transition-all placeholder-neutral-700 hover:border-neutral-700"
                                placeholder="admin@orbit.com"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-widest">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className="w-full bg-[#111] border border-neutral-800 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[#c4a35a] outline-none transition-all placeholder-neutral-700 hover:border-neutral-700"
                                placeholder="••••••••"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !email || !password}
                            className="w-full bg-[#c4a35a] text-[#0a0a0a] font-bold uppercase text-xs tracking-widest py-3.5 rounded-lg hover:bg-[#d4b47d] transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(196,163,90,0.2)] hover:shadow-[0_0_30px_rgba(196,163,90,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-[0.98]"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : <>Sign In <ArrowRight size={16} /></>}
                        </button>
                    </form>

                    {/* Demo Credentials */}
                    <div className="mt-6 p-4 bg-neutral-900/50 border border-neutral-800 rounded-lg">
                        <p className="text-[10px] uppercase font-bold text-neutral-500 tracking-widest mb-3">Demo Accounts</p>
                        <div className="space-y-2 text-xs">
                            <div className="flex justify-between text-neutral-400">
                                <span>dev@orbit.com</span>
                                <span className="text-purple-400">SuperAdmin</span>
                            </div>
                            <div className="flex justify-between text-neutral-400">
                                <span>admin@orbit.com</span>
                                <span className="text-amber-400">Admin</span>
                            </div>
                            <div className="flex justify-between text-neutral-400">
                                <span>staff@orbit.com</span>
                                <span className="text-blue-400">Karyawan</span>
                            </div>
                        </div>
                        <p className="text-[10px] text-neutral-600 mt-2">Password: [role]123</p>
                    </div>

                    <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-white/5 flex items-center justify-between text-[9px] sm:text-[10px] text-neutral-600 uppercase tracking-wider">
                        <span>Orbit System v2.0</span>
                        <span>Secure Connection</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
