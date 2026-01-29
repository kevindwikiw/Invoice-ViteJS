import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

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
    token: string | null;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
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

// ============ API HELPER ============
const API_BASE = '/api';

async function fetchWithAuth(url: string, options: RequestInit = {}) {
    const token = localStorage.getItem('orbit_token');
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };

    if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    return fetch(`${API_BASE}${url}`, { ...options, headers });
}

// ============ CONTEXT ============
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [users, setUsers] = useState<User[]>([]);

    // Load token and user on mount
    useEffect(() => {
        const savedToken = localStorage.getItem('orbit_token');
        const savedUser = localStorage.getItem('orbit_user');

        if (savedToken && savedUser) {
            setToken(savedToken);
            setUser(JSON.parse(savedUser));
        }
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

            // Store token and user
            setToken(data.token);
            setUser(data.user);
            localStorage.setItem('orbit_token', data.token);
            localStorage.setItem('orbit_user', JSON.stringify(data.user));
            localStorage.setItem('isAuthenticated', 'true');

            return { success: true };
        } catch (e) {
            return { success: false, error: 'Network error' };
        }
    };

    const logout = () => {
        setUser(null);
        setToken(null);
        setUsers([]);
        localStorage.removeItem('orbit_token');
        localStorage.removeItem('orbit_user');
        localStorage.removeItem('isAuthenticated');
    };

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

            // Refresh users list
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

            // Refresh users list
            await fetchUsers();
            return { success: true };
        } catch (e) {
            return { success: false, error: 'Network error' };
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user && !!token,
            token,
            login,
            logout,
            hasPermission,
            allUsers: users,
            fetchUsers,
            addUser,
            removeUser
        }}>
            {children}
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

// Export fetch helper for other components to use
export { fetchWithAuth };
