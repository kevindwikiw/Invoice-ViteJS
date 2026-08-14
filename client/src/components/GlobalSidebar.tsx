import { memo, useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
    PlusCircle,
    Package,
    FileClock,
    Menu,
    X,
    Moon,
    Sun,
    LogOut,
    Users,
    Shield,
    TrendingUp,
    ClipboardList,
    ChevronLeft,
    ChevronRight,
    type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth, getRoleLabel, getRoleColor, type FeaturePermission, type User } from '../context/auth';
import OrbitLogo from '../assets/pdf/logo.png';
import { useDarkMode } from '../hooks/useDarkMode';

type SidebarItemProps = {
    to: string;
    icon: LucideIcon;
    label: string;
    onClick: () => void;
};

const SidebarItem = memo(function SidebarItem({ to, icon: Icon, label, onClick }: SidebarItemProps) {
    return (
        <Link
            to={to}
            onClick={onClick}
            className="relative flex items-center gap-3 px-4 py-3.5 text-sm transition-colors group hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}
            activeProps={{
                className: '!border-r-2 !bg-[var(--accent-muted)] !text-[var(--accent)]',
                style: { borderRightColor: 'var(--accent)' },
            }}
            activeOptions={{ exact: to === '/' }}
        >
            <Icon size={16} className="transition-colors group-hover:text-[var(--accent)]" />
            <span className="tracking-wide transition-colors group-hover:text-[var(--text-primary)]">{label}</span>
        </Link>
    );
});

const WORKSPACE_ITEMS = [
    { to: '/create', icon: PlusCircle, label: 'Generate Invoice' },
    { to: '/', icon: Package, label: 'Package Bundles' },
] as const;

const ANALYTICS_ITEMS: Array<{ to: string; icon: LucideIcon; label: string; permission: FeaturePermission }> = [
    { to: '/history', icon: FileClock, label: 'Billing History', permission: 'view_billing_history' },
    { to: '/analytics', icon: TrendingUp, label: 'Market Insights', permission: 'view_market_insights' },
];

type SidebarNavigationProps = {
    user: User;
    hasPermission: (action: FeaturePermission) => boolean;
    sidebarOpen: boolean;
    setSidebarOpen: Dispatch<SetStateAction<boolean>>;
    darkMode: boolean;
    setDarkMode: Dispatch<SetStateAction<boolean>>;
    isCollapsed: boolean;
    setIsCollapsed: Dispatch<SetStateAction<boolean>>;
    onLogout: () => void;
};

const SidebarNavigation = memo(function SidebarNavigation({
    user,
    hasPermission,
    sidebarOpen,
    setSidebarOpen,
    darkMode,
    setDarkMode,
    isCollapsed,
    setIsCollapsed,
    onLogout,
}: SidebarNavigationProps) {
    const closeMobileSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);
    const expandSidebar = useCallback(() => setIsCollapsed(false), [setIsCollapsed]);
    const collapseSidebar = useCallback(() => setIsCollapsed(true), [setIsCollapsed]);
    const toggleDarkMode = useCallback(() => setDarkMode((current) => !current), [setDarkMode]);

    return (
        <>
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 md:hidden"
                    style={{ background: 'rgba(0,0,0,0.8)' }}
                    onClick={closeMobileSidebar}
                />
            )}

            {isCollapsed && (
                <button
                    type="button"
                    onClick={expandSidebar}
                    className="fixed left-0 top-5 z-[60] hidden h-10 w-8 items-center justify-center rounded-r-lg border border-l-0 border-[var(--border)] bg-[var(--bg-card)] text-[var(--accent)] shadow-md transition-[width] hover:w-10 md:flex"
                    title="Expand Sidebar"
                    aria-label="Expand Sidebar"
                >
                    <ChevronRight size={16} />
                </button>
            )}

            <aside
                className={clsx(
                    'fixed inset-y-0 left-0 z-50 flex flex-col transition-transform duration-200 ease-out md:transition-none group',
                    isCollapsed ? 'w-16 md:w-16 md:translate-x-0' : 'w-60 md:translate-x-0',
                    sidebarOpen ? 'w-60 translate-x-0' : '-translate-x-full',
                )}
                style={{ background: 'var(--bg-card)', borderRight: '1px solid var(--border)', overflow: 'visible' }}
            >
                <div className={clsx('h-full min-w-0 flex-col', isCollapsed ? 'hidden' : 'flex')}>
                    <div className="flex items-center justify-between gap-3 p-5" style={{ borderBottom: '1px solid var(--border)' }}>
                        <img src={OrbitLogo} alt="Logo" width={160} height={40} className="h-10 w-auto aspect-[4/1] object-contain" style={{ filter: darkMode ? 'none' : 'invert(1)' }} />
                        <button type="button" onClick={collapseSidebar} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--accent)] md:flex" title="Collapse Sidebar" aria-label="Collapse Sidebar">
                            <ChevronLeft size={15} />
                        </button>
                        <button type="button" onClick={closeMobileSidebar} className="p-1 transition-opacity hover:opacity-70 md:hidden" style={{ color: 'var(--text-muted)' }} aria-label="Close sidebar">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="px-5 py-6" style={{ borderBottom: '1px solid var(--border)' }}>
                        <div className="flex items-center gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[#8b7340] text-base font-black text-[var(--bg-deep)] shadow-lg shadow-[var(--accent)]/10">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold tracking-tight text-[var(--text-primary)]">{user.name}</p>
                                <div className={clsx('mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.1em]', getRoleColor(user.role))}>
                                    <Shield size={10} strokeWidth={2.5} />
                                    {getRoleLabel(user.role)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <nav className="no-scrollbar flex-1 overflow-y-auto py-8">
                        <div className="mb-4 px-5"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent)] opacity-50">Workspace</span></div>
                        {WORKSPACE_ITEMS.map((item) => <SidebarItem key={item.to} {...item} onClick={closeMobileSidebar} />)}

                        <div className="mb-4 mt-10 px-5"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent)] opacity-50">Analytics</span></div>
                        {ANALYTICS_ITEMS.filter((item) => hasPermission(item.permission)).map((item) => <SidebarItem key={item.to} to={item.to} icon={item.icon} label={item.label} onClick={closeMobileSidebar} />)}

                        {(user.role === 'admin' || user.role === 'superadmin') && (
                            <>
                                <div className="mb-4 mt-10 px-5"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent)] opacity-50">Administration</span></div>
                                <SidebarItem to="/users" icon={Users} label="Team & Access" onClick={closeMobileSidebar} />
                                <SidebarItem to="/activity" icon={ClipboardList} label="Audit Logs" onClick={closeMobileSidebar} />
                            </>
                        )}
                    </nav>

                    <div className="space-y-2 p-4" style={{ borderTop: '1px solid var(--border)' }}>
                        <button type="button" onClick={toggleDarkMode} className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm transition-colors hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-secondary)' }}>
                            <div className="flex items-center gap-3">{darkMode ? <Sun size={16} /> : <Moon size={16} />}<span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span></div>
                        </button>
                        <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300">
                            <LogOut size={16} /><span className="tracking-wide">Logout</span>
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
});

const RouteContent = memo(function RouteContent() {
    return <div className="safe-bottom"><Outlet /></div>;
});

function AuthenticatedShell() {
    const { user, logout, hasPermission, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [darkMode, setDarkMode] = useDarkMode();

    useEffect(() => {
        if (!isAuthenticated) navigate({ to: '/login' });
    }, [isAuthenticated, navigate]);

    const handleLogout = useCallback(() => {
        void logout().then(() => navigate({ to: '/login' }));
    }, [logout, navigate]);

    if (!user) return null;

    return (
        <div className="flex min-h-screen" style={{ background: 'var(--bg-deep)' }}>
            <SidebarNavigation user={user} hasPermission={hasPermission} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} darkMode={darkMode} setDarkMode={setDarkMode} isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} onLogout={handleLogout} />
            <main className={clsx('min-h-screen min-w-0 flex-1 overflow-x-hidden', isCollapsed ? 'md:ml-16' : 'md:ml-60')}>
                <header className="safe-top sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 md:hidden">
                    <button type="button" onClick={() => setSidebarOpen(true)} className="-ml-2 p-2 text-[var(--text-primary)] hover:opacity-70" aria-label="Open sidebar">
                        <Menu size={20} />
                    </button>
                    <img src={OrbitLogo} alt="Logo" width={120} height={30} className="h-8 w-auto aspect-[4/1] object-contain" style={{ filter: darkMode ? 'none' : 'invert(1)' }} />
                    <div className={clsx('flex items-center gap-1 rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-wider', getRoleColor(user.role))}><Shield size={10} />{getRoleLabel(user.role)}</div>
                </header>
                <RouteContent />
            </main>
        </div>
    );
}

export const GlobalSidebar = AuthenticatedShell;
