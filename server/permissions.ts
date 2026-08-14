import { Database } from "bun:sqlite";

export const FEATURE_PERMISSION_KEYS = [
    "view_market_insights",
    "view_billing_history",
    "edit_billing_history",
    "view_audit_logs",
] as const;

export type FeaturePermissionKey = typeof FEATURE_PERMISSION_KEYS[number];
export type PermissionEffect = "grant" | "deny";

type RoleName = "superadmin" | "admin" | "employee";

const ROLE_DEFAULT_PERMISSIONS: Record<RoleName, FeaturePermissionKey[]> = {
    superadmin: [...FEATURE_PERMISSION_KEYS],
    admin: [...FEATURE_PERMISSION_KEYS],
    employee: ["view_billing_history"],
};

export function ensureUserPermissionsTable(sqlite: Database) {
    sqlite.run(`
        CREATE TABLE IF NOT EXISTS user_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            permission_key TEXT NOT NULL,
            effect TEXT NOT NULL CHECK(effect IN ('grant', 'deny')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, permission_key)
        )
    `);
    sqlite.run(`
        CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id
        ON user_permissions(user_id)
    `);
}

export function getRoleDefaultPermissions(role: string): FeaturePermissionKey[] {
    const normalized = (role || "employee") as RoleName;
    return ROLE_DEFAULT_PERMISSIONS[normalized] || ROLE_DEFAULT_PERMISSIONS.employee;
}

export function getPermissionOverrides(sqlite: Database, userId: number): Partial<Record<FeaturePermissionKey, PermissionEffect>> {
    const rows = sqlite.prepare(`
        SELECT permission_key as permissionKey, effect
        FROM user_permissions
        WHERE user_id = ?
    `).all(userId) as Array<{ permissionKey: string; effect: PermissionEffect }>;

    const overrides: Partial<Record<FeaturePermissionKey, PermissionEffect>> = {};
    for (const row of rows) {
        const key = row.permissionKey as FeaturePermissionKey;
        if (FEATURE_PERMISSION_KEYS.includes(key)) {
            overrides[key] = row.effect;
        }
    }
    return overrides;
}

export function evaluatePermission(
    role: string,
    overrides: Partial<Record<FeaturePermissionKey, PermissionEffect>>,
    key: FeaturePermissionKey
): boolean {
    const override = overrides[key];
    if (override === "deny") return false;
    if (override === "grant") return true;
    return getRoleDefaultPermissions(role).includes(key);
}

export function getEffectivePermissions(
    role: string,
    overrides: Partial<Record<FeaturePermissionKey, PermissionEffect>>
): Record<FeaturePermissionKey, boolean> {
    return FEATURE_PERMISSION_KEYS.reduce((acc, key) => {
        acc[key] = evaluatePermission(role, overrides, key);
        return acc;
    }, {} as Record<FeaturePermissionKey, boolean>);
}

export function hasFeaturePermission(sqlite: Database, user: { sub: number; role: string }, key: FeaturePermissionKey): boolean {
    const overrides = getPermissionOverrides(sqlite, user.sub);
    return evaluatePermission(user.role, overrides, key);
}
