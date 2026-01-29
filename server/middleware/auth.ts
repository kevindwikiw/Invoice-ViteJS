import type { Context, Next } from "hono";
import { verify } from "hono/jwt";

interface JWTPayload {
    sub: number;
    email: string;
    name: string;
    role: string;
    exp: number;
}

export const authMiddleware = async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "No token provided" }, 401);
    }

    const token = authHeader.split(" ")[1];

    try {
        const secret = process.env.JWT_SECRET || "fallback-secret-key";
        const decoded = await verify(token, secret, "HS256");

        // Cast to our payload type
        const payload: JWTPayload = {
            sub: decoded.sub as number,
            email: decoded.email as string,
            name: decoded.name as string,
            role: decoded.role as string,
            exp: decoded.exp as number,
        };

        // Check expiration
        if (payload.exp < Math.floor(Date.now() / 1000)) {
            return c.json({ error: "Token expired" }, 401);
        }

        // Attach user to context
        c.set("user", payload);

        await next();
    } catch (e) {
        console.error("Auth error:", e);
        return c.json({ error: "Invalid token" }, 401);
    }
};

// Role-based middleware factory
export const requireRole = (...roles: string[]) => {
    return async (c: Context, next: Next) => {
        const user = c.get("user") as JWTPayload | undefined;

        if (!user) {
            return c.json({ error: "Not authenticated" }, 401);
        }

        if (!roles.includes(user.role)) {
            return c.json({ error: "Permission denied" }, 403);
        }

        await next();
    };
};
