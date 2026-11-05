const RESERVED_SLUGS = new Set([
    "activity",
    "analytics",
    "culling",
    "create",
    "feedback",
    "feedback-inbox",
    "galleries",
    "history",
    "invoices",
    "login",
    "users",
]);

export function weddingSlugBase(title: string): string {
    const slug = title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)
        .replace(/-+$/g, "");
    return slug || "wedding-gallery";
}

export function weddingSlugCandidate(title: string, galleryId: number, attempt = 0): string {
    const base = weddingSlugBase(title);
    if (attempt === 0 && !RESERVED_SLUGS.has(base) && !/^\d+$/.test(base)) return base;
    const suffix = attempt <= 1 ? String(galleryId) : `${galleryId}-${attempt - 1}`;
    const prefix = base.slice(0, 63 - suffix.length).replace(/-+$/g, "");
    return `${prefix || "wedding"}-${suffix}`;
}

export function isReservedWeddingSlug(slug: string): boolean {
    return RESERVED_SLUGS.has(slug) || /^\d+$/.test(slug);
}
