export function isAllowedArchivePublicUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        if (url.protocol === "https:") return true;
        if (url.protocol !== "http:") return false;
        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        return hostname === "localhost" || hostname === "::1" || hostname === "127.0.0.1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    } catch {
        return false;
    }
}
