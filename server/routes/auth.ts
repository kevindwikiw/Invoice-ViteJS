import { Hono } from "hono";
import { sign } from "hono/jwt";
import { resetRateLimit } from "../middleware/rate-limit";
import { databaseDriver, one, run } from "../db/runtime";
import { getEffectivePermissions, getPermissionOverrides } from "../permissions";

const auth = new Hono();

function generateRefreshToken(): string {
    return `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

async function logAudit(event: string, data: {
    userId?: number;
    email?: string;
    ip: string;
    userAgent: string;
    success: boolean;
    details?: string;
}) {
    try {
        await run(`
            INSERT INTO audit_logs (event_type, user_id, email, ip_address, user_agent, success, details)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [event, data.userId || null, data.email || null, data.ip, data.userAgent, data.success ? 1 : 0, data.details || null]);
    } catch (e) {
        console.error("Failed to log audit:", e);
    }
}

function getClientInfo(c: any): { ip: string; userAgent: string } {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim()
        || c.req.header("x-real-ip")
        || "unknown";
    return { ip, userAgent: c.req.header("user-agent") || "unknown" };
}

const expiryCondition = databaseDriver === "postgres"
    ? "rt.expires_at > CURRENT_TIMESTAMP"
    : "julianday(rt.expires_at) > julianday('now')";

auth.post("/login", async (c) => {
    const { ip, userAgent } = getClientInfo(c);
    try {
        const { email, password } = await c.req.json();
        if (!email || !password) {
            await logAudit("LOGIN_ATTEMPT", { email, ip, userAgent, success: false, details: "Missing credentials" });
            return c.json({ error: "Email and password are required" }, 400);
        }

        const user = await one<{
            id: number;
            email: string;
            name: string;
            password_hash: string;
            role: string;
        }>("SELECT id, email, name, password_hash, role FROM users WHERE email = ?", [email.toLowerCase()]);

        if (!user) {
            await logAudit("LOGIN_ATTEMPT", { email, ip, userAgent, success: false, details: "User not found" });
            return c.json({ error: "Invalid email or password" }, 401);
        }

        if (!await Bun.password.verify(password, user.password_hash)) {
            await logAudit("LOGIN_ATTEMPT", { userId: user.id, email, ip, userAgent, success: false, details: "Wrong password" });
            return c.json({ error: "Invalid email or password" }, 401);
        }

        const secret = process.env.JWT_SECRET!;
        const accessToken = await sign({
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            exp: Math.floor(Date.now() / 1000) + 60 * 15,
        }, secret, "HS256");
        const refreshToken = generateRefreshToken();
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        await run("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?", [user.id]);
        await run(`INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`, [user.id, refreshToken, refreshExpiresAt]);
        resetRateLimit(ip);
        await logAudit("LOGIN_SUCCESS", { userId: user.id, email, ip, userAgent, success: true });

        const permissionOverrides = await getPermissionOverrides(user.id);
        return c.json({
            accessToken,
            refreshToken,
            expiresIn: 900,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                featurePermissions: getEffectivePermissions(user.role, permissionOverrides),
                permissionOverrides,
            },
        });
    } catch (e) {
        console.error("Login error:", e);
        await logAudit("LOGIN_ERROR", { ip, userAgent, success: false, details: String(e) });
        return c.json({ error: String(e) }, 500);
    }
});

auth.post("/refresh", async (c) => {
    const { ip, userAgent } = getClientInfo(c);
    try {
        const { refreshToken } = await c.req.json();
        if (!refreshToken) return c.json({ error: "Refresh token required" }, 400);

        const tokenData = await one<{
            id: number;
            user_id: number;
            email: string;
            name: string;
            role: string;
        }>(`
            SELECT rt.id, rt.user_id, u.email, u.name, u.role
            FROM refresh_tokens rt
            JOIN users u ON rt.user_id = u.id
            WHERE rt.token = ? AND rt.revoked = 0 AND ${expiryCondition}
        `, [refreshToken]);

        if (!tokenData) {
            await logAudit("REFRESH_FAILED", { ip, userAgent, success: false, details: "Invalid or expired refresh token" });
            return c.json({ error: "Invalid or expired refresh token" }, 401);
        }

        const consumed = await run("UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND revoked = 0", [tokenData.id]);
        if (consumed.changes !== 1) {
            await logAudit("REFRESH_REPLAY", { userId: tokenData.user_id, email: tokenData.email, ip, userAgent, success: false, details: "Refresh token already consumed" });
            return c.json({ error: "Invalid or expired refresh token" }, 401);
        }

        const accessToken = await sign({
            sub: tokenData.user_id,
            email: tokenData.email,
            name: tokenData.name,
            role: tokenData.role,
            exp: Math.floor(Date.now() / 1000) + 60 * 15,
        }, process.env.JWT_SECRET!, "HS256");
        const nextRefreshToken = generateRefreshToken();
        const nextRefreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await run("INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)", [tokenData.user_id, nextRefreshToken, nextRefreshExpiresAt]);
        await logAudit("TOKEN_REFRESH", { userId: tokenData.user_id, email: tokenData.email, ip, userAgent, success: true });

        const permissionOverrides = await getPermissionOverrides(tokenData.user_id);
        return c.json({
            accessToken,
            refreshToken: nextRefreshToken,
            expiresIn: 900,
            user: {
                id: tokenData.user_id,
                email: tokenData.email,
                name: tokenData.name,
                role: tokenData.role,
                featurePermissions: getEffectivePermissions(tokenData.role, permissionOverrides),
                permissionOverrides,
            },
        });
    } catch (e) {
        console.error("Refresh error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

auth.post("/logout", async (c) => {
    const { ip, userAgent } = getClientInfo(c);
    try {
        const { refreshToken } = await c.req.json();
        if (refreshToken) {
            const result = await run("UPDATE refresh_tokens SET revoked = 1 WHERE token = ?", [refreshToken]);
            if (result.changes > 0) await logAudit("LOGOUT", { ip, userAgent, success: true });
        }
        return c.json({ success: true });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

auth.get("/me", async (c) => {
    const user = (c.get("user" as any) || c.get("jwtPayload" as any)) as { sub?: number; role?: string; email?: string; name?: string } | undefined;
    if (!user) return c.json({ error: "Not authenticated" }, 401);
    const permissionOverrides = await getPermissionOverrides(Number(user.sub || 0));
    return c.json({ user: {
        ...user,
        featurePermissions: getEffectivePermissions(String(user.role || "employee"), permissionOverrides),
        permissionOverrides,
    } });
});

export default auth;
