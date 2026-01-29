import { Hono } from "hono";
import { sign } from "hono/jwt";
import { Database } from "bun:sqlite";

const auth = new Hono();
const sqlite = new Database("db/sqlite.db");

// Login endpoint
auth.post("/login", async (c) => {
    try {
        const { email, password } = await c.req.json();

        if (!email || !password) {
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
            return c.json({ error: "Invalid email or password" }, 401);
        }

        // Verify password
        const isValid = await Bun.password.verify(password, user.password_hash);
        if (!isValid) {
            return c.json({ error: "Invalid email or password" }, 401);
        }

        // Generate JWT token
        const payload = {
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
        };

        const secret = process.env.JWT_SECRET || "fallback-secret-key";
        const token = await sign(payload, secret, "HS256");

        return c.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
        });
    } catch (e) {
        console.error("Login error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// Get current user (requires auth middleware)
auth.get("/me", async (c) => {
    // User is attached by auth middleware
    const user = c.get("user");
    if (!user) {
        return c.json({ error: "Not authenticated" }, 401);
    }
    return c.json({ user });
});

export default auth;
