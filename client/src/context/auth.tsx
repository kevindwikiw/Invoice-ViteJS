import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

// ============ TYPES ============
export type UserRole = 'superadmin' | 'admin' | 'employee';

export interface User {
    id: number;
    email: string;
    name: string;
    role: UserRole;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<void>;
    hasPermission: (action: Permission) => boolean;
    allUsers: User[];
    fetchUsers: () => Promise<void>;
    addUser: (user: { email: string; name: string; password: string; role: UserRole }) => Promise<{ success: boolean; error?: string }>;
    removeUser: (userId: number) => Promise<{ success: boolean; error?: string }>;
}

// ============ PERMISSIONS ============
type Permission =
    | 'manage_users'
    | 'manage_packages'
    | 'delete_packages'
    | 'create_invoices'
    | 'edit_invoices'
    | 'download_invoices'
    | 'delete_history';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
    superadmin: [
        'manage_users',
        'manage_packages',
        'delete_packages',
        'create_invoices',
        'edit_invoices',
        'download_invoices',
        'delete_history'
    ],
    admin: [
        'manage_users',
        'manage_packages',
        'delete_packages',
        'create_invoices',
        'edit_invoices',
        'download_invoices',
        'delete_history'
    ],
    employee: [
        'create_invoices',
        'edit_invoices',
        'download_invoices'
    ]
};

// ============ TOKEN MANAGEMENT ============
const API_BASE = '/api';

// Store tokens
let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiresAt: number = 0;
let refreshingPromise: Promise<boolean> | null = null; // Lock for refresh

// Load tokens from localStorage
function loadTokens() {
    accessToken = localStorage.getItem('orbit_access_token');
    refreshToken = localStorage.getItem('orbit_refresh_token');
    tokenExpiresAt = parseInt(localStorage.getItem('orbit_token_expires') || '0');
}

// Save tokens to localStorage
function saveTokens(access: string, refresh: string, expiresIn: number) {
    accessToken = access;
    refreshToken = refresh;
    tokenExpiresAt = Date.now() + (expiresIn * 1000) - 60000; // 1 min buffer

    localStorage.setItem('orbit_access_token', access);
    localStorage.setItem('orbit_refresh_token', refresh);
    localStorage.setItem('orbit_token_expires', String(tokenExpiresAt));
}

// Clear tokens
function clearTokens() {
    accessToken = null;
    refreshToken = null;
    tokenExpiresAt = 0;

    localStorage.removeItem('orbit_access_token');
    localStorage.removeItem('orbit_refresh_token');
    localStorage.removeItem('orbit_token_expires');
    localStorage.removeItem('orbit_user');
    localStorage.removeItem('isAuthenticated');
}

// Refresh the access token (with lock)
async function refreshAccessToken(): Promise<boolean> {
    if (!refreshToken) return false;
    if (refreshingPromise) return refreshingPromise;

    refreshingPromise = (async () => {
        try {
            const res = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });

            if (!res.ok) {
                clearTokens();
                return false;
            }

            const data = await res.json();
            accessToken = data.accessToken;
            tokenExpiresAt = Date.now() + (data.expiresIn * 1000) - 60000;

            localStorage.setItem('orbit_access_token', data.accessToken);
            localStorage.setItem('orbit_token_expires', String(tokenExpiresAt));

            return true;
        } catch {
            clearTokens();
            return false;
        } finally {
            refreshingPromise = null;
        }
    })();

    return refreshingPromise;
}

// Get valid access token (refresh if needed)
async function getValidToken(): Promise<string | null> {
    if (!accessToken) {
        loadTokens();
    }

    // Check if token is expired or about to expire
    if (tokenExpiresAt < Date.now()) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) return null;
    }

    return accessToken;
}

// Fetch with auth (auto-refresh)
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const token = await getValidToken();

    if (!token) {
        throw new Error('Not authenticated');
    }

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        ...(options.headers as Record<string, string> || {}),
    };

    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_BASE}${url}`, { ...options, headers });

    // If 401, try to refresh and retry once
    if (res.status === 401) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
            const retryHeaders: Record<string, string> = {
                'Authorization': `Bearer ${accessToken}`,
                ...(options.headers as Record<string, string> || {}),
            };

            if (!(options.body instanceof FormData)) {
                retryHeaders['Content-Type'] = 'application/json';
            }

            return fetch(`${API_BASE}${url}`, { ...options, headers: retryHeaders });
        } else {
            // Refresh failed, force logout (redirect will happen via auth state change)
            clearTokens();
            window.dispatchEvent(new Event('orbit:auth-failed'));
            throw new Error('Session expired');
        }
    }

    return res;
}

// ============ CONTEXT ============
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [isReady, setIsReady] = useState(false);

    // Load user on mount & listen to storage
    useEffect(() => {
        const initAuth = () => {
            loadTokens();
            const savedUser = localStorage.getItem('orbit_user');

            if (savedUser && accessToken) {
                try {
                    setUser(JSON.parse(savedUser));
                } catch {
                    clearTokens();
                    setUser(null);
                }
            } else {
                setUser(null);
            }
            setIsReady(true);
        };

        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'orbit_access_token' || e.key === 'orbit_user') {
                initAuth();
            }
        };

        window.addEventListener('storage', handleStorage);
        initAuth();

        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                return { success: false, error: data.error || 'Login failed' };
            }

            // Store tokens
            saveTokens(data.accessToken, data.refreshToken, data.expiresIn);

            // Store user
            setUser(data.user);
            localStorage.setItem('orbit_user', JSON.stringify(data.user));
            localStorage.setItem('isAuthenticated', 'true');

            return { success: true };
        } catch (e) {
            return { success: false, error: 'Network error' };
        }
    };

    const logout = useCallback(async () => {
        const oldRefresh = refreshToken; // capture before clearing

        setUser(null);
        setUsers([]);
        clearTokens();

        // Notify other tabs immediately
        window.dispatchEvent(new Event('storage'));

        // Call server logout to revoke refresh token
        if (oldRefresh) {
            try {
                await fetch(`${API_BASE}/auth/logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: oldRefresh }),
                });
            } catch {
                // Ignore errors
            }
        }
    }, []);

    const hasPermission = (action: Permission): boolean => {
        if (!user) return false;
        return ROLE_PERMISSIONS[user.role].includes(action);
    };

    const fetchUsers = async () => {
        try {
            const res = await fetchWithAuth('/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
            }
        } catch (e) {
            console.error('Failed to fetch users:', e);
        }
    };

    const addUser = async (newUser: { email: string; name: string; password: string; role: UserRole }): Promise<{ success: boolean; error?: string }> => {
        try {
            const res = await fetchWithAuth('/users', {
                method: 'POST',
                body: JSON.stringify(newUser),
            });

            const data = await res.json();

            if (!res.ok) {
                return { success: false, error: data.error || 'Failed to create user' };
            }

            await fetchUsers();
            return { success: true };
        } catch (e) {
            return { success: false, error: 'Network error' };
        }
    };

    const removeUser = async (userId: number): Promise<{ success: boolean; error?: string }> => {
        try {
            const res = await fetchWithAuth(`/users/${userId}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                return { success: false, error: data.error || 'Failed to delete user' };
            }

            await fetchUsers();
            return { success: true };
        } catch (e) {
            return { success: false, error: 'Network error' };
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user && !!accessToken,
            login,
            logout,
            hasPermission,
            allUsers: users,
            fetchUsers,
            addUser,
            removeUser
        }}>
            {isReady ? children : null}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}

// Role display helper
export function getRoleLabel(role: UserRole): string {
    switch (role) {
        case 'superadmin': return 'Super Admin';
        case 'admin': return 'Admin';
        case 'employee': return 'Karyawan';
    }
}

export function getRoleColor(role: UserRole): string {
    switch (role) {
        case 'superadmin': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
        case 'admin': return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
        case 'employee': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
    }
}
