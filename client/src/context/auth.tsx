/* eslint-disable react-refresh/only-export-components -- context, hook, and display helpers intentionally share this module. */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
    apiFetch,
    clearAuthTokens,
    fetchWithAuth,
    hasAccessToken,
    loadAuthTokens,
    saveAuthTokens,
} from '../lib/api';

// ============ TYPES ============
export type UserRole = 'superadmin' | 'admin' | 'employee';
export type FeaturePermission = 'view_market_insights' | 'view_billing_history' | 'edit_billing_history' | 'view_audit_logs' | 'view_feedback_inbox' | 'manage_client_galleries';
export type PermissionEffect = 'grant' | 'deny';
export type PermissionOverrideMode = PermissionEffect | 'inherit';

export type FeaturePermissionMap = Record<FeaturePermission, boolean>;
export type PermissionOverrideMap = Partial<Record<FeaturePermission, PermissionEffect>>;

export interface User {
    id: number;
    email: string;
    name: string;
    role: UserRole;
    featurePermissions?: FeaturePermissionMap;
    permissionOverrides?: PermissionOverrideMap;
}

export interface UserPermissionResponse {
    userId: number;
    role: UserRole;
    permissions: Array<{ key: FeaturePermission; override: PermissionOverrideMode; effective: boolean }>;
    permissionOverrides: PermissionOverrideMap;
    featurePermissions: FeaturePermissionMap;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<void>;
    hasPermission: (action: Permission) => boolean;
}

// ============ PERMISSIONS ============
type Permission =
    | 'manage_users'
    | 'manage_packages'
    | 'delete_packages'
    | 'create_invoices'
    | 'edit_invoices'
    | 'download_invoices'
    | 'delete_history'
    | FeaturePermission;

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
    superadmin: [
        'manage_users',
        'manage_packages',
        'delete_packages',
        'create_invoices',
        'edit_invoices',
        'download_invoices',
        'delete_history',
        'view_market_insights',
        'view_billing_history',
        'edit_billing_history',
        'view_audit_logs',
        'view_feedback_inbox',
        'manage_client_galleries',
    ],
    admin: [
        'manage_users',
        'manage_packages',
        'delete_packages',
        'create_invoices',
        'edit_invoices',
        'download_invoices',
        'delete_history',
        'view_market_insights',
        'view_billing_history',
        'edit_billing_history',
        'view_audit_logs',
        'view_feedback_inbox',
        'manage_client_galleries',
    ],
    employee: [
        'create_invoices',
        'edit_invoices',
        'download_invoices',
        'view_billing_history',
    ]
};

const FEATURE_PERMISSIONS: FeaturePermission[] = ['view_market_insights', 'view_billing_history', 'edit_billing_history', 'view_audit_logs', 'view_feedback_inbox', 'manage_client_galleries'];
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'orbit_last_activity';

// ============ CONTEXT ============
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isReady, setIsReady] = useState(false);

    const mergeUserPermissionState = useCallback((baseUser: User, data: { featurePermissions?: FeaturePermissionMap; permissionOverrides?: PermissionOverrideMap }): User => {
        return {
            ...baseUser,
            featurePermissions: data.featurePermissions || baseUser.featurePermissions,
            permissionOverrides: data.permissionOverrides || baseUser.permissionOverrides,
        };
    }, []);

    const syncUserPermissionProfile = useCallback(async (targetUser: User | null) => {
        if (!targetUser) return;
        try {
            const res = await fetchWithAuth(`/users/${targetUser.id}/permissions`);
            if (!res.ok) return;
            const data = await res.json() as UserPermissionResponse;
            setUser(prev => {
                const seed = prev && prev.id === targetUser.id ? prev : targetUser;
                const merged = mergeUserPermissionState(seed, {
                    featurePermissions: data.featurePermissions,
                    permissionOverrides: data.permissionOverrides,
                });
                localStorage.setItem('orbit_user', JSON.stringify(merged));
                return merged;
            });
        } catch (e) {
            console.error('Failed to sync permission profile:', e);
        }
    }, [mergeUserPermissionState]);

    // Load user on mount & listen to storage
    useEffect(() => {
        const initAuth = () => {
            loadAuthTokens();
            const savedUser = localStorage.getItem('orbit_user');

            if (savedUser && hasAccessToken()) {
                try {
                    setUser(JSON.parse(savedUser));
                } catch {
                    clearAuthTokens();
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
        const handleTokenRefreshed = (event: Event) => {
            const refreshedUser = (event as CustomEvent<User | null>).detail || null;
            if (refreshedUser) {
                setUser(() => {
                    const merged = mergeUserPermissionState(refreshedUser, {
                        featurePermissions: refreshedUser.featurePermissions,
                        permissionOverrides: refreshedUser.permissionOverrides,
                    });
                    localStorage.setItem('orbit_user', JSON.stringify(merged));
                    return merged;
                });
            } else {
                const currentRaw = localStorage.getItem('orbit_user');
                if (currentRaw) {
                    try {
                        const currentUser = JSON.parse(currentRaw) as User;
                        void syncUserPermissionProfile(currentUser);
                    } catch {
                        // Ignore malformed cached user data and continue auth initialization.
                    }
                }
            }
        };

        window.addEventListener('storage', handleStorage);
        window.addEventListener('orbit:token-refreshed', handleTokenRefreshed as EventListener);
        initAuth();

        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('orbit:token-refreshed', handleTokenRefreshed as EventListener);
        };
    }, [mergeUserPermissionState, syncUserPermissionProfile]);

    useEffect(() => {
        if (!isReady || !user) return;
        const hasEffective = !!user.featurePermissions && FEATURE_PERMISSIONS.every((key) => typeof user.featurePermissions?.[key] === 'boolean');
        if (hasEffective) return;

        const timer = window.setTimeout(() => {
            void syncUserPermissionProfile(user);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isReady, user, syncUserPermissionProfile]);

    const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const res = await apiFetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                return { success: false, error: data.error || 'Login failed' };
            }

            // Credentials are stored in HttpOnly cookies by the server.
            saveAuthTokens();

            // Store user
            setUser(data.user);
            localStorage.setItem('orbit_user', JSON.stringify(data.user));
            localStorage.setItem('isAuthenticated', 'true');
            await syncUserPermissionProfile(data.user as User);

            return { success: true };
        } catch {
            return { success: false, error: 'Network error' };
        }
    };

    const logout = useCallback(async () => {
        setUser(null);
        clearAuthTokens();
        localStorage.removeItem(LAST_ACTIVITY_KEY);

        // Notify other tabs immediately
        window.dispatchEvent(new Event('storage'));

        // Call server logout to revoke refresh token cookie.
        try {
            await apiFetch('/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
        } catch {
            // Ignore errors
        }
    }, []);

    useEffect(() => {
        if (!user) return;

        let timeoutId: number | undefined;
        let lastRecordedAt = 0;

        const getLastActivity = () => Number.parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
        const scheduleLogout = () => {
            if (timeoutId) window.clearTimeout(timeoutId);
            const lastActivity = getLastActivity();
            const elapsed = Date.now() - lastActivity;

            if (lastActivity && elapsed >= IDLE_TIMEOUT_MS) {
                void logout();
                return;
            }

            timeoutId = window.setTimeout(scheduleLogout, Math.max(0, IDLE_TIMEOUT_MS - Math.max(0, elapsed)));
        };

        const recordActivity = () => {
            const now = Date.now();
            // Throttle storage writes while still keeping the timeout accurate.
            if (now - lastRecordedAt < 10_000) return;
            lastRecordedAt = now;
            localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
            scheduleLogout();
        };

        const handleStorage = (event: StorageEvent) => {
            if (event.key === LAST_ACTIVITY_KEY) scheduleLogout();
        };

        if (!getLastActivity()) recordActivity();
        scheduleLogout();

        const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'focus'];
        activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
        window.addEventListener('storage', handleStorage);

        return () => {
            if (timeoutId) window.clearTimeout(timeoutId);
            activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
            window.removeEventListener('storage', handleStorage);
        };
    }, [logout, user]);

    const hasPermission = useCallback((action: Permission): boolean => {
        if (!user) return false;

        if (FEATURE_PERMISSIONS.includes(action as FeaturePermission)) {
            const key = action as FeaturePermission;
            const override = user.permissionOverrides?.[key];
            if (override === 'deny') return false;
            if (override === 'grant') return true;
            if (user.featurePermissions && typeof user.featurePermissions[key] === 'boolean') {
                return !!user.featurePermissions[key];
            }
        }

        return ROLE_PERMISSIONS[user.role].includes(action);
    }, [user]);

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user && hasAccessToken(),
            login,
            logout,
            hasPermission,
        }}>
            { isReady? children: null }
        </AuthContext.Provider >
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
