import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign } from "hono/jwt";
import { clientIp, resetRateLimit } from "../middleware/rate-limit";
import { databaseDriver, one, run } from "../db/runtime";
import { getEffectivePermissions, getPermissionOverrides } from "../permissions";

const auth = new Hono();
const ACCESS_COOKIE = "orbit_access";
const REFRESH_COOKIE = "orbit_refresh";
const ACCESS_TOKEN_SECONDS = 60 * 15;
const REFRESH_TOKEN_SECONDS = 7 * 24 * 60 * 60;

function cookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax" as const,
        path: "/",
        maxAge,
    };
}

function setAuthCookies(c: any, accessToken: string, refreshToken: string) {
    setCookie(c, ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TOKEN_SECONDS));
    setCookie(c, REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_TOKEN_SECONDS));
}

function clearAuthCookies(c: any) {
    deleteCookie(c, ACCESS_COOKIE, { path: "/" });
    deleteCookie(c, REFRESH_COOKIE, { path: "/" });
}

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
    return { ip: clientIp(c), userAgent: c.req.header("user-agent") || "unknown" };
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
        await resetRateLimit(ip);
        await logAudit("LOGIN_SUCCESS", { userId: user.id, email, ip, userAgent, success: true });

        const permissionOverrides = await getPermissionOverrides(user.id);
        setAuthCookies(c, accessToken, refreshToken);
        return c.json({
            expiresIn: ACCESS_TOKEN_SECONDS,
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
        const body = await c.req.json().catch(() => ({})) as { refreshToken?: string };
        const refreshToken = getCookie(c, REFRESH_COOKIE) || body.refreshToken;
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
        setAuthCookies(c, accessToken, nextRefreshToken);
        return c.json({
            expiresIn: ACCESS_TOKEN_SECONDS,
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
        const body = await c.req.json().catch(() => ({})) as { refreshToken?: string };
        const refreshToken = getCookie(c, REFRESH_COOKIE) || body.refreshToken;
        if (refreshToken) {
            const result = await run("UPDATE refresh_tokens SET revoked = 1 WHERE token = ?", [refreshToken]);
            if (result.changes > 0) await logAudit("LOGOUT", { ip, userAgent, success: true });
        }
        clearAuthCookies(c);
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
