import { Hono } from "hono";
import { sign } from "hono/jwt";
import { Database } from "bun:sqlite";
import { resetRateLimit } from "../middleware/rate-limit";
import { getEffectivePermissions, getPermissionOverrides } from "../permissions";

const auth = new Hono();
const sqlite = new Database("db/sqlite.db");

// Auto-create required auth tables if missing
try {
    sqlite.run(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            revoked INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    sqlite.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            user_id INTEGER,
            email TEXT,
            ip_address TEXT,
            user_agent TEXT,
            success INTEGER DEFAULT 1,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
} catch (e) {
    console.error("Failed to initialize auth tables:", e);
}

// ============ HELPERS ============
function generateRefreshToken(): string {
    // UUIDs are generated from a cryptographically secure random source in Bun.
    // Do not use Math.random() for bearer credentials.
    return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

function logAudit(event: string, data: {
    userId?: number;
    email?: string;
    ip: string;
    userAgent: string;
    success: boolean;
    details?: string;
}) {
    try {
        sqlite.prepare(`
            INSERT INTO audit_logs (event_type, user_id, email, ip_address, user_agent, success, details)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(event, data.userId || null, data.email || null, data.ip, data.userAgent, data.success ? 1 : 0, data.details || null);
    } catch (e) {
        console.error("Failed to log audit:", e);
    }
}

function getClientInfo(c: any): { ip: string; userAgent: string } {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim()
        || c.req.header("x-real-ip")
        || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";
    return { ip, userAgent };
}

// ============ LOGIN ============
auth.post("/login", async (c) => {
    const { ip, userAgent } = getClientInfo(c);

    try {
        const { email, password } = await c.req.json();

        if (!email || !password) {
            logAudit("LOGIN_ATTEMPT", { email, ip, userAgent, success: false, details: "Missing credentials" });
            return c.json({ error: "Email and password are required" }, 400);
        }

        // Find user by email
        const user = sqlite.query(`
            SELECT id, email, name, password_hash, role FROM users WHERE email = ?
        `).get(email.toLowerCase()) as {
            id: number;
            email: string;
            name: string;
            password_hash: string;
            role: string;
        } | null;

        if (!user) {
            logAudit("LOGIN_ATTEMPT", { email, ip, userAgent, success: false, details: "User not found" });
            return c.json({ error: "Invalid email or password" }, 401);
        }

        // Verify password
        const isValid = await Bun.password.verify(password, user.password_hash);
        if (!isValid) {
            logAudit("LOGIN_ATTEMPT", { userId: user.id, email, ip, userAgent, success: false, details: "Wrong password" });
            return c.json({ error: "Invalid email or password" }, 401);
        }

        // Generate access token (15 min)
        const accessPayload = {
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            exp: Math.floor(Date.now() / 1000) + 60 * 15, // 15 minutes
        };

        const secret = process.env.JWT_SECRET || "fallback-secret-key";
        const accessToken = await sign(accessPayload, secret, "HS256");

        // Generate refresh token (7 days)
        const refreshToken = generateRefreshToken();
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Revoke old refresh tokens for this user
        sqlite.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`).run(user.id);

        // Store new refresh token
        sqlite.prepare(`
            INSERT INTO refresh_tokens (user_id, token, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, refreshToken, refreshExpiresAt);

        // Reset rate limit on successful login
        resetRateLimit(ip);

        // Log successful login
        logAudit("LOGIN_SUCCESS", { userId: user.id, email, ip, userAgent, success: true });
        const permissionOverrides = getPermissionOverrides(sqlite, user.id);
        const featurePermissions = getEffectivePermissions(user.role, permissionOverrides);

        return c.json({
            accessToken,
            refreshToken,
            expiresIn: 900, // 15 minutes in seconds
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                featurePermissions,
                permissionOverrides,
            },
        });
    } catch (e) {
        console.error("Login error:", e);
        logAudit("LOGIN_ERROR", { ip, userAgent, success: false, details: String(e) });
        return c.json({ error: String(e) }, 500);
    }
});

// ============ REFRESH TOKEN ============
auth.post("/refresh", async (c) => {
    const { ip, userAgent } = getClientInfo(c);

    try {
        const { refreshToken } = await c.req.json();

        if (!refreshToken) {
            return c.json({ error: "Refresh token required" }, 400);
        }

        // Find valid refresh token
        const tokenData = sqlite.query(`
            SELECT rt.*, u.email, u.name, u.role 
            FROM refresh_tokens rt
            JOIN users u ON rt.user_id = u.id
            WHERE rt.token = ? AND rt.revoked = 0 AND julianday(rt.expires_at) > julianday('now')
        `).get(refreshToken) as {
            id: number;
            user_id: number;
            email: string;
            name: string;
            role: string;
        } | null;

        if (!tokenData) {
            logAudit("REFRESH_FAILED", { ip, userAgent, success: false, details: "Invalid or expired refresh token" });
            return c.json({ error: "Invalid or expired refresh token" }, 401);
        }

        // Rotate the refresh token before issuing a new access token. The
        // conditional update makes concurrent refresh requests single-use:
        // only the first request can consume the old token.
        const consumed = sqlite.prepare(
            `UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND revoked = 0`
        ).run(tokenData.id);
        if (consumed.changes !== 1) {
            logAudit("REFRESH_REPLAY", { userId: tokenData.user_id, email: tokenData.email, ip, userAgent, success: false, details: "Refresh token already consumed" });
            return c.json({ error: "Invalid or expired refresh token" }, 401);
        }

        // Generate a new access token
        const accessPayload = {
            sub: tokenData.user_id,
            email: tokenData.email,
            name: tokenData.name,
            role: tokenData.role,
            exp: Math.floor(Date.now() / 1000) + 60 * 15,
        };

        const secret = process.env.JWT_SECRET || "fallback-secret-key";
        const accessToken = await sign(accessPayload, secret, "HS256");

        const nextRefreshToken = generateRefreshToken();
        const nextRefreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        sqlite.prepare(`
            INSERT INTO refresh_tokens (user_id, token, expires_at)
            VALUES (?, ?, ?)
        `).run(tokenData.user_id, nextRefreshToken, nextRefreshExpiresAt);

        logAudit("TOKEN_REFRESH", { userId: tokenData.user_id, email: tokenData.email, ip, userAgent, success: true });

        const permissionOverrides = getPermissionOverrides(sqlite, tokenData.user_id);
        const featurePermissions = getEffectivePermissions(tokenData.role, permissionOverrides);

        return c.json({
            accessToken,
            refreshToken: nextRefreshToken,
            expiresIn: 900,
            user: {
                id: tokenData.user_id,
                email: tokenData.email,
                name: tokenData.name,
                role: tokenData.role,
                featurePermissions,
                permissionOverrides,
            },
        });
    } catch (e) {
        console.error("Refresh error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// ============ LOGOUT ============
auth.post("/logout", async (c) => {
    const { ip, userAgent } = getClientInfo(c);

    try {
        const { refreshToken } = await c.req.json();

        if (refreshToken) {
            // Revoke the refresh token
            const result = sqlite.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE token = ?`).run(refreshToken);

            if (result.changes > 0) {
                logAudit("LOGOUT", { ip, userAgent, success: true });
            }
        }

        return c.json({ success: true });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

// ============ GET CURRENT USER ============
auth.get("/me", async (c) => {
    const user = (c.get("user" as any) || c.get("jwtPayload" as any)) as { sub?: number; role?: string; email?: string; name?: string } | undefined;
    if (!user) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    const permissionOverrides = getPermissionOverrides(sqlite, Number(user.sub || 0));
    const featurePermissions = getEffectivePermissions(String(user.role || "employee"), permissionOverrides);

    return c.json({
        user: {
            ...user,
            featurePermissions,
            permissionOverrides,
        },
    });
});

export default auth;
