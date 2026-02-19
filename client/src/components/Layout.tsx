import { useState, useEffect } from 'react';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { PlusCircle, Package, FileClock, Menu, X, Moon, Sun, LogOut, Users, Shield, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { useAuth, getRoleLabel, getRoleColor } from '../context/auth';

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
    const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile
    const [isCollapsed, setIsCollapsed] = useState(false); // Desktop
    const { user, logout, hasPermission, isAuthenticated } = useAuth();
    const navigate = useNavigate();

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

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!isAuthenticated) {
            navigate({ to: '/login' });
        }
    }, [isAuthenticated, navigate]);

    const handleLogout = () => {
        logout();
        navigate({ to: '/login' });
    };

    if (!user) return null;

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
                "fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out group",
                // Mobile: standard handling
                // Desktop: handle collapse. If collapsed: w-0. If open: w-60.
                isCollapsed ? "md:w-0" : "w-60 md:translate-x-0",
                sidebarOpen ? "translate-x-0 w-60" : "-translate-x-full"
            )} style={{
                background: 'var(--bg-card)',
                borderRight: '1px solid var(--border)',
                overflow: 'visible'
            }}>
                {/* Curtain Toggle Tab */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="hidden md:flex absolute top-1/2 -translate-y-1/2 -right-3 w-3 h-12 bg-[var(--bg-card)] border-y border-r border-[var(--border)] rounded-r-md items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-all hover:w-6 hover:-right-6 z-50 shadow-sm"
                    title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    <div className="w-0.5 h-4 bg-[var(--accent)] rounded-full" />
                </button>



                {/* Inner Content Wrapper (Hidden when collapsed) */}
                <div className={clsx("flex flex-col h-full min-w-[15rem] transition-opacity duration-200", isCollapsed ? "opacity-0 invisible" : "opacity-100 visible")}>
                    {/* Logo */}
                    <div className="p-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                        <div className="flex items-center gap-3">
                            <img
                                src="/logo.png"
                                alt="Logo"
                                className="h-24 w-auto object-contain"
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

                    {/* User Info */}
                    <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-[var(--accent)] flex items-center justify-center text-[var(--bg-deep)] font-bold text-sm">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{user.name}</p>
                                <div className={clsx("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border mt-1", getRoleColor(user.role))}>
                                    <Shield size={10} />
                                    {getRoleLabel(user.role)}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 py-6 overflow-y-auto">
                        <div className="px-4 mb-3">
                            <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Menu</span>
                        </div>
                        <SidebarItem to="/create" icon={PlusCircle} label="Create Invoice" onClick={() => setSidebarOpen(false)} />
                        <SidebarItem to="/history" icon={FileClock} label="History" onClick={() => setSidebarOpen(false)} />
                        <SidebarItem to="/analytics" icon={TrendingUp} label="Analytics" onClick={() => setSidebarOpen(false)} />

                        <div className="px-4 mt-8 mb-3">
                            <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Manage</span>
                        </div>
                        <SidebarItem to="/" icon={Package} label="Packages" onClick={() => setSidebarOpen(false)} />

                        {/* SuperAdmin Only: User Management */}
                        {hasPermission('manage_users') && (
                            <SidebarItem to="/users" icon={Users} label="User Management" onClick={() => setSidebarOpen(false)} />
                        )}
                    </nav>

                    {/* Bottom Section */}
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                        {/* Theme Toggle */}
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className="w-full flex items-center justify-between px-4 py-3 text-sm transition-all hover:bg-[var(--bg-hover)]"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            <span className="flex items-center gap-3">
                                {darkMode ? <Moon size={16} /> : <Sun size={16} />}
                                <span className="tracking-wide">{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
                            </span>
                            <div className="w-10 h-5 rounded-full relative transition-colors" style={{ background: darkMode ? 'var(--accent)' : 'var(--border)' }}>
                                <div className={clsx("absolute top-0.5 w-4 h-4 rounded-full transition-transform", darkMode ? "translate-x-5" : "translate-x-0.5")} style={{ background: 'var(--bg-deep)' }} />
                            </div>
                        </button>

                        {/* Logout */}
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-all hover:bg-red-500/10 text-red-400 hover:text-red-300"
                        >
                            <LogOut size={16} />
                            <span className="tracking-wide">Logout</span>
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main */}
            <main className={clsx(
                "flex-1 min-h-screen transition-all duration-300 ease-in-out",
                isCollapsed ? "md:ml-0" : "md:ml-60"
            )}>

                {/* Desktop Expand Button (Removed, replaced by curtain tab) */}

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
                        className="h-12 w-auto object-contain"
                        style={{ filter: darkMode ? 'none' : 'invert(1)' }}
                    />
                    <div className={clsx("flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider border", getRoleColor(user.role))}>
                        <Shield size={10} />
                        {getRoleLabel(user.role)}
                    </div>
                </header>

                <div className="safe-bottom">
                    <Outlet />
                </div>
            </main>
        </div >
    );
};
