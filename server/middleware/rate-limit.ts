import type { Context, Next } from "hono";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory store (for single instance, use Redis for multi-instance)
const loginAttempts = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of loginAttempts.entries()) {
        if (entry.resetAt < now) {
            loginAttempts.delete(ip);
        }
    }
}, 5 * 60 * 1000);

export const loginRateLimiter = async (c: Context, next: Next) => {
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"); // 15 minutes
    const maxAttempts = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || "5");

    // Get client IP
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim()
        || c.req.header("x-real-ip")
        || "unknown";

    const now = Date.now();
    const entry = loginAttempts.get(ip);

    // Check if rate limited
    if (entry) {
        if (entry.resetAt > now) {
            if (entry.count >= maxAttempts) {
                const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
                c.header("Retry-After", String(retryAfter));
                return c.json({
                    error: "Too many login attempts. Please try again later.",
                    retryAfter
                }, 429);
            }
            // Increment count
            entry.count++;
        } else {
            // Window expired, reset
            loginAttempts.set(ip, { count: 1, resetAt: now + windowMs });
        }
    } else {
        // First attempt
        loginAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    }

    await next();
};

// Reset rate limit on successful login (optional)
export const resetRateLimit = (ip: string) => {
    loginAttempts.delete(ip);
};

// Get remaining attempts for IP
export const getRemainingAttempts = (ip: string): number => {
    const maxAttempts = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || "5");
    const entry = loginAttempts.get(ip);
    if (!entry || entry.resetAt < Date.now()) return maxAttempts;
    return Math.max(0, maxAttempts - entry.count);
};
