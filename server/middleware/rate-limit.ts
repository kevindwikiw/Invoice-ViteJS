import type { Context, Next } from "hono";
import { hitRateLimit, remainingRateLimit, resetRateLimitKey, resetRateLimitSuffixes } from "../db/rate-limit";

const RATE_LIMIT_ERROR_LOG_MS = 60_000;
const rateLimitErrorLogTimes = new Map<string, number>();

function logRateLimitStorageError(key: string, message: string, error: unknown) {
    const scope = key.split(":")[0] || key;
    const now = Date.now();
    const lastLoggedAt = rateLimitErrorLogTimes.get(scope) || 0;
    if (now - lastLoggedAt < RATE_LIMIT_ERROR_LOG_MS) return;
    rateLimitErrorLogTimes.set(scope, now);
    console.error(message, error);
}

export function clientIp(c: Context): string {
    return c.req.header("fly-client-ip")
        || c.req.header("cf-connecting-ip")
        || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
        || c.req.header("x-real-ip")
        || "unknown";
}

export const loginRateLimiter = async (c: Context, next: Next) => {
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"); // 15 minutes
    const maxAttempts = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || "5");
    const ip = clientIp(c);
    const result = await hitRateLimitSafely(`login:${ip}`, windowMs, maxAttempts);
    if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfter || 0));
        return c.json({
            error: "Too many login attempts. Please try again later.",
            retryAfter: result.retryAfter || 0
        }, 429);
    }
    await next();
};

export const galleryPinRateLimiter = async (c: Context, next: Next) => {
    const windowMs = Number.parseInt(process.env.GALLERY_PIN_RATE_LIMIT_WINDOW_MS || "900000", 10);
    const maxAttempts = Number.parseInt(process.env.GALLERY_PIN_RATE_LIMIT_MAX || "5", 10);
    const galleryId = c.req.param("id") || "unknown";
    const result = await hitRateLimitSafely(`gallery_pin:${clientIp(c)}:${galleryId}`, windowMs, maxAttempts);
    if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfter || 0));
        return c.json({ error: "Too many PIN attempts. Please try again later.", retryAfter: result.retryAfter || 0, code: "PIN_RATE_LIMITED" }, 429);
    }
    await next();
};

export const resetGalleryPinAttempts = async (identifiers: string[]) => {
    try {
        await resetRateLimitSuffixes("gallery_pin", identifiers.filter(Boolean));
    } catch (error) {
        logRateLimitStorageError("gallery_pin", "Unable to reset gallery PIN rate limits.", error);
    }
};

export const feedbackRateLimiter = async (c: Context, next: Next) => {
    const windowMs = Number.parseInt(process.env.FEEDBACK_RATE_LIMIT_WINDOW_MS || "3600000", 10);
    const maxSubmissions = Number.parseInt(process.env.FEEDBACK_RATE_LIMIT_MAX || "5", 10);
    const ip = clientIp(c);
    const result = await hitRateLimitSafely(`feedback:${ip}`, windowMs, maxSubmissions);
    if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfter || 0));
        return c.json({
            error: "Too many feedback submissions. Please try again later.",
            retryAfter: result.retryAfter || 0,
        }, 429);
    }
    await next();
};

async function hitRateLimitSafely(key: string, windowMs: number, maxAttempts: number) {
    try {
        return await hitRateLimit(key, windowMs, maxAttempts);
    } catch (error) {
        logRateLimitStorageError(key, `Rate limit check failed for ${key}. Allowing request.`, error);
        return {
            allowed: true,
            count: 0,
            resetAt: Date.now() + windowMs,
        };
    }
}

// Reset rate limit on successful login (optional)
export const resetRateLimit = async (ip: string) => {
    try {
        await resetRateLimitKey(`login:${ip}`);
    } catch (error) {
        logRateLimitStorageError(`login:${ip}`, `Unable to reset login rate limit for ${ip}.`, error);
    }
};

// Get remaining attempts for IP
export const getRemainingAttempts = async (ip: string): Promise<number> => {
    const maxAttempts = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || "5");
    try {
        return await remainingRateLimit(`login:${ip}`, maxAttempts);
    } catch (error) {
        logRateLimitStorageError(`login:${ip}`, `Unable to read remaining login attempts for ${ip}.`, error);
        return maxAttempts;
    }
};
