import { Hono } from "hono";
import { sign } from "hono/jwt";
import { Database } from "bun:sqlite";
import { resetRateLimit } from "../middleware/rate-limit";

const auth = new Hono();
const sqlite = new Database("db/sqlite.db");

// ============ HELPERS ============
function generateRefreshToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 64; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
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

        return c.json({
            accessToken,
            refreshToken,
            expiresIn: 900, // 15 minutes in seconds
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
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
            WHERE rt.token = ? AND rt.revoked = 0 AND rt.expires_at > datetime('now')
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

        // Generate new access token
        const accessPayload = {
            sub: tokenData.user_id,
            email: tokenData.email,
            name: tokenData.name,
            role: tokenData.role,
            exp: Math.floor(Date.now() / 1000) + 60 * 15,
        };

        const secret = process.env.JWT_SECRET || "fallback-secret-key";
        const accessToken = await sign(accessPayload, secret, "HS256");

        logAudit("TOKEN_REFRESH", { userId: tokenData.user_id, email: tokenData.email, ip, userAgent, success: true });

        return c.json({
            accessToken,
            expiresIn: 900,
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
    const user = c.get("user");
    if (!user) {
        return c.json({ error: "Not authenticated" }, 401);
    }
    return c.json({ user });
});

export default auth;
