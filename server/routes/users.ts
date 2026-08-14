import { Hono } from "hono";
import { all, insertReturningId, one, run } from "../db/runtime";
import {
    FEATURE_PERMISSION_KEYS,
    getEffectivePermissions,
    getPermissionOverrides,
    type FeaturePermissionKey,
    type PermissionEffect,
} from "../permissions";

const users = new Hono();

interface UserActivityInput {
    action: string;
    targetUserId?: number | null;
    targetUserName?: string | null;
    targetUserEmail?: string | null;
    actor?: { sub?: number; email?: string; name?: string; role?: string } | null;
    details?: string | null;
    ipAddress?: string | null;
}

async function logUserActivity(input: UserActivityInput) {
    try {
        await run(`
            INSERT INTO user_activity_logs (
                action, target_user_id, target_user_name, target_user_email,
                actor_id, actor_email, actor_name, actor_role, details, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            input.action,
            input.targetUserId || null,
            input.targetUserName || null,
            input.targetUserEmail || null,
            input.actor?.sub || null,
            input.actor?.email || null,
            input.actor?.name || null,
            input.actor?.role || null,
            input.details || null,
            input.ipAddress || null,
        ]);
    } catch (e) {
        console.error("Failed to log user activity:", e);
    }
}

function currentUser(c: any): any {
    return c.get("user") || c.get("jwtPayload");
}

users.get("/activity", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);
    if (user.role !== "admin" && user.role !== "superadmin") return c.json({ error: "Permission denied. Admin only." }, 403);

    try {
        const search = (c.req.query("search") || "").trim().toLowerCase();
        const action = (c.req.query("action") || "").trim().toUpperCase();
        const safeLimit = Math.min(Math.max(parseInt(c.req.query("limit") || "100"), 1), 300);
        const requestedPage = Math.max(parseInt(c.req.query("page") || "1"), 1);
        const conditions: string[] = [];
        const params: Array<string | number> = [];
        if (action && action !== "ALL") { conditions.push("UPPER(action) = ?"); params.push(action); }
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
            params.push(pattern, pattern, pattern, pattern, pattern, pattern);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const summary = await one<{ total: number; created: number | null; deleted: number | null; accessUpdated: number | null; passwordReset: number | null }>(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN action = 'USER_CREATED' THEN 1 ELSE 0 END) as created,
                   SUM(CASE WHEN action = 'USER_DELETED' THEN 1 ELSE 0 END) as deleted,
                   SUM(CASE WHEN action = 'USER_PERMISSIONS_UPDATED' THEN 1 ELSE 0 END) as "accessUpdated",
                   SUM(CASE WHEN action = 'USER_PASSWORD_RESET' THEN 1 ELSE 0 END) as "passwordReset"
            FROM user_activity_logs ${where}
        `, params);
        const total = Number(summary?.total || 0);
        const totalPages = Math.max(1, Math.ceil(total / safeLimit));
        const page = Math.min(requestedPage, totalPages);
        const rows = await all(`
            SELECT id, action, target_user_id as "targetUserId", target_user_name as "targetUserName",
                   target_user_email as "targetUserEmail", actor_id as "actorId", actor_email as "actorEmail",
                   actor_name as "actorName", actor_role as "actorRole", details, ip_address as "ipAddress",
                   created_at as "createdAt"
            FROM user_activity_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?
        `, [...params, safeLimit, (page - 1) * safeLimit]);
        return c.json({
            items: rows, page, limit: safeLimit, total, totalPages,
            stats: {
                total,
                created: Number(summary?.created || 0),
                deleted: Number(summary?.deleted || 0),
                accessUpdated: Number(summary?.accessUpdated || 0),
                passwordReset: Number(summary?.passwordReset || 0),
            },
        });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

users.get("/", async (c) => {
    const actor = currentUser(c);
    if (!actor) return c.json({ error: "Not authenticated" }, 401);
    if (actor.role !== "admin" && actor.role !== "superadmin") return c.json({ error: "Permission denied" }, 403);
    try {
        const rows = await all<{ id: number; email: string; name: string; role: string; created_at: string }>(
            actor.role === "admin"
                ? "SELECT id, email, name, role, created_at FROM users WHERE role != 'superadmin' ORDER BY id"
                : "SELECT id, email, name, role, created_at FROM users ORDER BY id"
        );
        return c.json(await Promise.all(rows.map(async (row) => {
            const overrides = await getPermissionOverrides(row.id);
            return { ...row, featurePermissions: getEffectivePermissions(row.role, overrides) };
        })));
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

users.post("/", async (c) => {
    const actor = currentUser(c);
    if (!actor) return c.json({ error: "Not authenticated" }, 401);
    if (actor.role !== "admin" && actor.role !== "superadmin") return c.json({ error: "Permission denied" }, 403);
    try {
        const { email, name, password, role } = await c.req.json();
        if (!email || !name || !password) return c.json({ error: "Email, name, and password are required" }, 400);
        if (actor.role === "admin" && role === "superadmin") return c.json({ error: "Permission denied" }, 403);
        const normalizedEmail = String(email).toLowerCase();
        if (await one("SELECT id FROM users WHERE email = ?", [normalizedEmail])) return c.json({ error: "Email already exists" }, 400);
        const userRole = role || "employee";
        if (!["superadmin", "admin", "employee"].includes(userRole)) return c.json({ error: "Invalid role. Must be: superadmin, admin, or employee" }, 400);
        const passwordHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
        const id = await insertReturningId("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)", [normalizedEmail, name, passwordHash, userRole]);
        await logUserActivity({ action: "USER_CREATED", targetUserId: id, targetUserName: name, targetUserEmail: normalizedEmail, actor, details: `Role assigned: ${userRole}` });
        return c.json({ id, email: normalizedEmail, name, role: userRole });
    } catch (e) { console.error("Create user error:", e); return c.json({ error: String(e) }, 500); }
});

users.delete("/:id", async (c) => {
    const actor = currentUser(c);
    if (!actor) return c.json({ error: "Not authenticated" }, 401);
    if (actor.role !== "admin" && actor.role !== "superadmin") return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        if (id === actor.sub) return c.json({ error: "Cannot delete yourself" }, 400);
        const target = await one<{ id: number; name: string; email: string; role: string }>("SELECT id, name, email, role FROM users WHERE id = ?", [id]);
        if (!target) return c.json({ error: "User not found" }, 404);
        if (actor.role === "admin" && target.role === "superadmin") return c.json({ error: "Permission denied" }, 403);
        await run("DELETE FROM users WHERE id = ?", [id]);
        await logUserActivity({ action: "USER_DELETED", targetUserId: id, targetUserName: target.name, targetUserEmail: target.email, actor, details: `User account (${target.role}) removed` });
        return c.json({ status: "deleted" });
    } catch (e) { console.error("Delete user error:", e); return c.json({ error: String(e) }, 500); }
});

users.get("/:id/permissions", async (c) => {
    const actor = currentUser(c);
    if (!actor) return c.json({ error: "Not authenticated" }, 401);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid user ID" }, 400);
    const canManage = actor.role === "admin" || actor.role === "superadmin";
    if (id !== actor.sub && !canManage) return c.json({ error: "Permission denied" }, 403);
    const target = await one<{ id: number; role: string }>("SELECT id, role FROM users WHERE id = ?", [id]);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (actor.role === "admin" && target.role === "superadmin") return c.json({ error: "Permission denied" }, 403);
    const overrides = await getPermissionOverrides(id);
    const effective = getEffectivePermissions(target.role, overrides);
    return c.json({ userId: id, role: target.role, permissions: FEATURE_PERMISSION_KEYS.map((key) => ({ key, override: overrides[key] || "inherit", effective: effective[key] })), permissionOverrides: overrides, featurePermissions: effective });
});

users.put("/:id/permissions", async (c) => {
    const actor = currentUser(c);
    if (!actor) return c.json({ error: "Not authenticated" }, 401);
    if (actor.role !== "admin" && actor.role !== "superadmin") return c.json({ error: "Permission denied" }, 403);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid user ID" }, 400);
    const target = await one<{ id: number; name: string; email: string; role: string }>("SELECT id, name, email, role FROM users WHERE id = ?", [id]);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (actor.role === "admin" && target.role === "superadmin") return c.json({ error: "Permission denied" }, 403);
    const body = await c.req.json().catch(() => ({}));
    const incoming = (body.overrides || {}) as Record<string, "grant" | "deny" | "inherit">;
    for (const [key, value] of Object.entries(incoming)) {
        if (!FEATURE_PERMISSION_KEYS.includes(key as FeaturePermissionKey)) return c.json({ error: `Invalid permission key: ${key}` }, 400);
        if (!["grant", "deny", "inherit"].includes(value)) return c.json({ error: `Invalid override value for ${key}` }, 400);
    }
    await run("DELETE FROM user_permissions WHERE user_id = ?", [id]);
    for (const key of FEATURE_PERMISSION_KEYS) {
        const value = incoming[key];
        if (value === "grant" || value === "deny") await run("INSERT INTO user_permissions (user_id, permission_key, effect) VALUES (?, ?, ?)", [id, key, value as PermissionEffect]);
    }
    const overrides = await getPermissionOverrides(id);
    const effective = getEffectivePermissions(target.role, overrides);
    await logUserActivity({ action: "USER_PERMISSIONS_UPDATED", targetUserId: id, targetUserName: target.name || `User #${id}`, targetUserEmail: target.email || "", actor, details: `Updated overrides: ${Object.keys(incoming).join(", ") || "reset"}` });
    return c.json({ status: "updated", userId: id, permissions: FEATURE_PERMISSION_KEYS.map((key) => ({ key, override: overrides[key] || "inherit", effective: effective[key] })), permissionOverrides: overrides, featurePermissions: effective });
});

users.put("/:id/password", async (c) => {
    const actor = currentUser(c);
    if (!actor) return c.json({ error: "Not authenticated" }, 401);
    if (actor.role !== "admin" && actor.role !== "superadmin") return c.json({ error: "Permission denied. Admin only." }, 403);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid user ID" }, 400);
    const target = await one<{ id: number; name: string; email: string; role: string }>("SELECT id, name, email, role FROM users WHERE id = ?", [id]);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (actor.role === "admin" && target.role === "superadmin") return c.json({ error: "Permission denied. Admin cannot reset superadmin password." }, 403);
    try {
        const { password } = await c.req.json().catch(() => ({}));
        if (!password || typeof password !== "string" || password.length < 6) return c.json({ error: "Password must be at least 6 characters" }, 400);
        const passwordHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
        await run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id]);
        await logUserActivity({ action: "USER_PASSWORD_RESET", targetUserId: id, targetUserName: target.name, targetUserEmail: target.email, actor, details: `Password reset by ${actor.name || actor.role}` });
        return c.json({ status: "success", message: "Password reset successfully" });
    } catch (e) { console.error("Reset password error:", e); return c.json({ error: String(e) }, 500); }
});

export default users;
