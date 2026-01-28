import { useState, useEffect } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { LayoutDashboard, PlusCircle, Package, Settings, FileClock, Menu, X, Moon, Sun } from 'lucide-react';
import clsx from 'clsx';

const SidebarItem = ({ to, icon: Icon, label, onClick }: { to: string, icon: any, label: string, onClick?: () => void }) => {
    return (
        <Link
            to={to}
            onClick={onClick}
            className="flex items-center gap-3 px-4 py-3 text-sm transition-all group hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}
            activeProps={{
                className: "!text-[var(--accent)] !bg-[var(--accent-muted)] border-l-2",
                style: { borderColor: 'var(--accent)' }
            }}
            activeOptions={{ exact: to === '/' }}
        >
            <Icon size={16} className="group-hover:text-[var(--accent)] transition-colors" />
            <span className="tracking-wide group-hover:text-[var(--text-primary)] transition-colors">{label}</span>
        </Link>
    );
};

export const Layout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [darkMode, setDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('darkMode');
            if (saved !== null) return saved === 'true';
            return true;
        }
        return true;
    });

    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
            document.documentElement.classList.remove('light');
        } else {
            document.documentElement.classList.add('light');
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('darkMode', String(darkMode));
    }, [darkMode]);

    return (
        <div className="flex min-h-screen" style={{ background: 'var(--bg-deep)' }}>
            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 md:hidden"
                    style={{ background: 'rgba(0,0,0,0.8)' }}
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={clsx(
                "w-60 fixed inset-y-0 left-0 z-50 flex flex-col transition-transform duration-300",
                "md:translate-x-0",
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
            )} style={{
                background: 'var(--bg-card)',
                borderRight: '1px solid var(--border)'
            }}>
                {/* Logo */}
                <div className="p-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-3">
                        <img
                            src="/logo.png"
                            alt="Logo"
                            className="h-10 w-auto object-contain"
                            style={{ filter: darkMode ? 'none' : 'invert(1)' }}
                        />
                    </div>
                    <button
                        onClick={() => setSidebarOpen(false)}
                        className="md:hidden p-1 hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--text-muted)' }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Nav */}
                <nav className="flex-1 py-6">
                    <div className="px-4 mb-3">
                        <span
                            className="text-xs tracking-widest uppercase"
                            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}
                        >
                            Menu
                        </span>
                    </div>
                    <SidebarItem to="/" icon={LayoutDashboard} label="Dashboard" onClick={() => setSidebarOpen(false)} />
                    <SidebarItem to="/create" icon={PlusCircle} label="Create Invoice" onClick={() => setSidebarOpen(false)} />
                    <SidebarItem to="/history" icon={FileClock} label="History" onClick={() => setSidebarOpen(false)} />

                    <div className="px-4 mt-8 mb-3">
                        <span
                            className="text-xs tracking-widest uppercase"
                            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}
                        >
                            Manage
                        </span>
                    </div>
                    <SidebarItem to="/packages" icon={Package} label="Packages" onClick={() => setSidebarOpen(false)} />
                    <SidebarItem to="/settings" icon={Settings} label="Settings" onClick={() => setSidebarOpen(false)} />
                </nav>

                {/* Theme Toggle */}
                <div className="p-4" style={{ borderTop: '1px solid var(--border)' }}>
                    <button
                        onClick={() => setDarkMode(!darkMode)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-sm transition-all hover:bg-[var(--bg-hover)]"
                        style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}
                    >
                        <span className="flex items-center gap-3">
                            {darkMode ? <Moon size={16} /> : <Sun size={16} />}
                            <span className="tracking-wide">{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
                        </span>
                        <div
                            className="w-10 h-5 rounded-full relative transition-colors"
                            style={{ background: darkMode ? 'var(--accent)' : 'var(--border)' }}
                        >
                            <div
                                className={clsx(
                                    "absolute top-0.5 w-4 h-4 rounded-full transition-transform",
                                    darkMode ? "translate-x-5" : "translate-x-0.5"
                                )}
                                style={{ background: 'var(--bg-deep)' }}
                            />
                        </div>
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 md:ml-60 min-h-screen">
                {/* Mobile Header */}
                <header
                    className="md:hidden sticky top-0 z-30 px-4 py-3 flex items-center justify-between safe-top"
                    style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}
                >
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-2 -ml-2 hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <Menu size={20} />
                    </button>
                    <img
                        src="/logo.png"
                        alt="Logo"
                        className="h-8 w-auto object-contain"
                        style={{ filter: darkMode ? 'none' : 'invert(1)' }}
                    />
                    <button
                        onClick={() => setDarkMode(!darkMode)}
                        className="p-2 -mr-2 hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {darkMode ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                </header>

                <div className="safe-bottom">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};
