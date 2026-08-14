import { Hono } from "hono";
import { Database } from "bun:sqlite";
import {
    FEATURE_PERMISSION_KEYS,
    getEffectivePermissions,
    getPermissionOverrides,
    type FeaturePermissionKey,
    type PermissionEffect,
} from "../permissions";

const users = new Hono();
const sqlite = new Database(process.env.SQLITE_PATH || "db/sqlite.db");

// Auto-create user activity logs table & index
try {
    sqlite.run(`
        CREATE TABLE IF NOT EXISTS user_activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            target_user_id INTEGER,
            target_user_name TEXT,
            target_user_email TEXT,
            actor_id INTEGER,
            actor_email TEXT,
            actor_name TEXT,
            actor_role TEXT,
            details TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    sqlite.run(`
        CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs(created_at DESC);
    `);
} catch (e) {
    console.error("Failed to initialize user_activity_logs table:", e);
}

interface UserActivityInput {
    action: string;
    targetUserId?: number | null;
    targetUserName?: string | null;
    targetUserEmail?: string | null;
    actor?: { sub?: number; email?: string; name?: string; role?: string } | null;
    details?: string | null;
    ipAddress?: string | null;
}

function logUserActivity(input: UserActivityInput) {
    try {
        sqlite.prepare(`
            INSERT INTO user_activity_logs (
                action, target_user_id, target_user_name, target_user_email,
                actor_id, actor_email, actor_name, actor_role, details, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            input.action,
            input.targetUserId || null,
            input.targetUserName || null,
            input.targetUserEmail || null,
            input.actor?.sub || null,
            input.actor?.email || null,
            input.actor?.name || null,
            input.actor?.role || null,
            input.details || null,
            input.ipAddress || null
        );
    } catch (e) {
        console.error("Failed to log user activity:", e);
    }
}

// User Audit Logs Endpoint (Admin / Superadmin only)
users.get("/activity", async (c) => {
    const currentUser = (c.get("user" as any) || c.get("jwtPayload" as any)) as any;

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied. Admin only." }, 403);
    }

    try {
        const search = (c.req.query("search") || "").trim().toLowerCase();
        const action = (c.req.query("action") || "").trim().toUpperCase();
        const limitParam = parseInt(c.req.query("limit") || "100");
        const pageParam = parseInt(c.req.query("page") || "1");
        const safeLimit = Math.min(Math.max(limitParam, 1), 300);
        const requestedPage = Math.max(pageParam, 1);
        const conditions: string[] = [];
        const queryParams: Array<string | number> = [];

        if (action && action !== "ALL") {
            conditions.push("UPPER(action) = ?");
            queryParams.push(action);
        }
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(`(
                LOWER(COALESCE(target_user_name, '')) LIKE ?
                OR LOWER(COALESCE(target_user_email, '')) LIKE ?
                OR LOWER(COALESCE(actor_name, '')) LIKE ?
                OR LOWER(COALESCE(actor_email, '')) LIKE ?
                OR LOWER(COALESCE(details, '')) LIKE ?
                OR LOWER(COALESCE(action, '')) LIKE ?
            )`);
            queryParams.push(pattern, pattern, pattern, pattern, pattern, pattern);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const summary = sqlite.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN action = 'USER_CREATED' THEN 1 ELSE 0 END) as created,
                SUM(CASE WHEN action = 'USER_DELETED' THEN 1 ELSE 0 END) as deleted,
                SUM(CASE WHEN action = 'USER_PERMISSIONS_UPDATED' THEN 1 ELSE 0 END) as accessUpdated,
                SUM(CASE WHEN action = 'USER_PASSWORD_RESET' THEN 1 ELSE 0 END) as passwordReset
            FROM user_activity_logs
            ${whereClause}
        `).get(...queryParams) as {
            total: number;
            created: number | null;
            deleted: number | null;
            accessUpdated: number | null;
            passwordReset: number | null;
        };

        const total = Number(summary.total || 0);
        const totalPages = Math.max(1, Math.ceil(total / safeLimit));
        const safePage = Math.min(requestedPage, totalPages);
        const offset = (safePage - 1) * safeLimit;

        const rows = sqlite.prepare(`
            SELECT
                id,
                action,
                target_user_id as targetUserId,
                target_user_name as targetUserName,
                target_user_email as targetUserEmail,
                actor_id as actorId,
                actor_email as actorEmail,
                actor_name as actorName,
                actor_role as actorRole,
                details,
                ip_address as ipAddress,
                created_at as createdAt
            FROM user_activity_logs
            ${whereClause}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        `).all(...queryParams, safeLimit, offset) as Array<Record<string, unknown>>;

        return c.json({
            items: rows,
            page: safePage,
            limit: safeLimit,
            total,
            totalPages,
            stats: {
                total,
                created: Number(summary.created || 0),
                deleted: Number(summary.deleted || 0),
                accessUpdated: Number(summary.accessUpdated || 0),
                passwordReset: Number(summary.passwordReset || 0),
            },
        });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

// Get all users (filter out superadmin for non-superadmin)
users.get("/", async (c) => {
    const currentUser = (c.get("user" as any) || c.get("jwtPayload" as any)) as any;

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    // Only admin and superadmin can list users
    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        let query = "SELECT id, email, name, role, created_at FROM users";

        // If current user is admin (not superadmin), hide superadmin users
        if (currentUser.role === "admin") {
            query += " WHERE role != 'superadmin'";
        }

        const result = sqlite.query(query).all() as Array<{ id: number; email: string; name: string; role: string; created_at: string }>;

        const withPermissionPreview = result.map((row) => {
            const overrides = getPermissionOverrides(sqlite, row.id);
            return {
                ...row,
                featurePermissions: getEffectivePermissions(row.role, overrides),
            };
        });

        return c.json(withPermissionPreview);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

// Create user
users.post("/", async (c) => {
    const currentUser = (c.get("user" as any) || c.get("jwtPayload" as any)) as any;

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    // Only admin and superadmin can create users
    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const { email, name, password, role } = await c.req.json();

        if (!email || !name || !password) {
            return c.json({ error: "Email, name, and password are required" }, 400);
        }

        // Admin cannot create superadmin
        if (currentUser.role === "admin" && role === "superadmin") {
            return c.json({ error: "Permission denied" }, 403);
        }

        // Check if email exists
        const existing = sqlite.query("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
        if (existing) {
            return c.json({ error: "Email already exists" }, 400);
        }

        // Validate role - whitelist only valid roles
        const validRoles = ["superadmin", "admin", "employee"];
        const userRole = role || "employee";
        if (!validRoles.includes(userRole)) {
            return c.json({ error: "Invalid role. Must be: superadmin, admin, or employee" }, 400);
        }

        // Hash password
        const passwordHash = await Bun.password.hash(password, {
            algorithm: "bcrypt",
            cost: 10,
        });

        // Insert user
        const result = sqlite.prepare(`
            INSERT INTO users (email, name, password_hash, role)
            VALUES (?, ?, ?, ?)
        `).run(email.toLowerCase(), name, passwordHash, userRole);

        const newUserId = Number(result.lastInsertRowid);

        logUserActivity({
            action: "USER_CREATED",
            targetUserId: newUserId,
            targetUserName: name,
            targetUserEmail: email.toLowerCase(),
            actor: currentUser,
            details: `Role assigned: ${userRole}`
        });

        return c.json({
            id: newUserId,
            email: email.toLowerCase(),
            name,
            role: userRole,
        });
    } catch (e) {
        console.error("Create user error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// Delete user
users.delete("/:id", async (c) => {
    const currentUser = (c.get("user" as any) || c.get("jwtPayload" as any)) as any;

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    // Only admin and superadmin can delete users
    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = Number(c.req.param("id"));

        // Cannot delete self
        if (id === currentUser.sub) {
            return c.json({ error: "Cannot delete yourself" }, 400);
        }

        // Check target user role
        const targetUser = sqlite.query("SELECT id, name, email, role FROM users WHERE id = ?").get(id) as { id: number; name: string; email: string; role: string } | null;

        if (!targetUser) {
            return c.json({ error: "User not found" }, 404);
        }

        // Admin cannot delete superadmin
        if (currentUser.role === "admin" && targetUser.role === "superadmin") {
            return c.json({ error: "Permission denied" }, 403);
        }

        sqlite.prepare("DELETE FROM users WHERE id = ?").run(id);

        logUserActivity({
            action: "USER_DELETED",
            targetUserId: id,
            targetUserName: targetUser.name,
            targetUserEmail: targetUser.email,
            actor: currentUser,
            details: `User account (${targetUser.role}) removed`
        });

        return c.json({ status: "deleted" });
    } catch (e) {
        console.error("Delete user error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

users.get("/:id/permissions", async (c) => {
    const currentUser = (c.get("user" as any) || c.get("jwtPayload" as any)) as any;

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
        return c.json({ error: "Invalid user ID" }, 400);
    }

    const isSelf = id === currentUser.sub;
    const canManage = currentUser.role === "admin" || currentUser.role === "superadmin";
    if (!isSelf && !canManage) {
        return c.json({ error: "Permission denied" }, 403);
    }

    const targetUser = sqlite.query(`SELECT id, role FROM users WHERE id = ?`).get(id) as { id: number; role: string } | null;
    if (!targetUser) {
        return c.json({ error: "User not found" }, 404);
    }

    if (currentUser.role === "admin" && targetUser.role === "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    const overrides = getPermissionOverrides(sqlite, id);
    const effective = getEffectivePermissions(targetUser.role, overrides);

    return c.json({
        userId: id,
        role: targetUser.role,
        permissions: FEATURE_PERMISSION_KEYS.map((key) => ({
            key,
            override: overrides[key] || "inherit",
            effective: effective[key],
        })),
        permissionOverrides: overrides,
        featurePermissions: effective,
    });
});

users.put("/:id/permissions", async (c) => {
    const currentUser = (c.get("user" as any) || c.get("jwtPayload" as any)) as any;

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
        return c.json({ error: "Invalid user ID" }, 400);
    }

    const targetUser = sqlite.query(`SELECT id, name, email, role FROM users WHERE id = ?`).get(id) as { id: number; name: string; email: string; role: string } | null;
    if (!targetUser) {
        return c.json({ error: "User not found" }, 404);
    }

    if (currentUser.role === "admin" && targetUser.role === "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const incoming = (body.overrides || {}) as Record<string, "grant" | "deny" | "inherit">;

    for (const [key, value] of Object.entries(incoming)) {
        if (!FEATURE_PERMISSION_KEYS.includes(key as FeaturePermissionKey)) {
            return c.json({ error: `Invalid permission key: ${key}` }, 400);
        }
        if (!["grant", "deny", "inherit"].includes(value)) {
            return c.json({ error: `Invalid override value for ${key}` }, 400);
        }
    }

    const tx = sqlite.transaction(() => {
        sqlite.prepare(`DELETE FROM user_permissions WHERE user_id = ?`).run(id);

        for (const key of FEATURE_PERMISSION_KEYS) {
            const value = incoming[key];
            if (value === "grant" || value === "deny") {
                sqlite.prepare(`
                    INSERT INTO user_permissions (user_id, permission_key, effect)
                    VALUES (?, ?, ?)
                `).run(id, key, value as PermissionEffect);
            }
        }
    });

    tx();

    const overrides = getPermissionOverrides(sqlite, id);
    const effective = getEffectivePermissions(targetUser.role, overrides);

    logUserActivity({
        action: "USER_PERMISSIONS_UPDATED",
        targetUserId: id,
        targetUserName: targetUser.name || `User #${id}`,
        targetUserEmail: targetUser.email || '',
        actor: currentUser,
        details: `Updated overrides: ${Object.keys(incoming).join(", ") || "reset"}`
    });

    return c.json({
        status: "updated",
        userId: id,
        permissions: FEATURE_PERMISSION_KEYS.map((key) => ({
            key,
            override: overrides[key] || "inherit",
            effective: effective[key],
        })),
        permissionOverrides: overrides,
        featurePermissions: effective,
    });
});

// Reset User Password (Admin / Superadmin only)
users.put("/:id/password", async (c) => {
    const currentUser = (c.get("user" as any) || c.get("jwtPayload" as any)) as any;

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied. Admin only." }, 403);
    }

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
        return c.json({ error: "Invalid user ID" }, 400);
    }

    const targetUser = sqlite.query(`SELECT id, name, email, role FROM users WHERE id = ?`).get(id) as { id: number; name: string; email: string; role: string } | null;
    if (!targetUser) {
        return c.json({ error: "User not found" }, 404);
    }

    if (currentUser.role === "admin" && targetUser.role === "superadmin") {
        return c.json({ error: "Permission denied. Admin cannot reset superadmin password." }, 403);
    }

    try {
        const body = await c.req.json().catch(() => ({}));
        const { password } = body;

        if (!password || typeof password !== "string" || password.length < 6) {
            return c.json({ error: "Password must be at least 6 characters" }, 400);
        }

        const passwordHash = await Bun.password.hash(password, {
            algorithm: "bcrypt",
            cost: 10,
        });

        sqlite.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, id);

        logUserActivity({
            action: "USER_PASSWORD_RESET",
            targetUserId: id,
            targetUserName: targetUser.name,
            targetUserEmail: targetUser.email,
            actor: currentUser,
            details: `Password reset by ${currentUser.name || currentUser.role}`
        });

        return c.json({ status: "success", message: "Password reset successfully" });
    } catch (e) {
        console.error("Reset password error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

export default users;
