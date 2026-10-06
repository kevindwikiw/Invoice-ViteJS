import { galleryAll } from "../db/galleries";

const GALLERY_SETTINGS_TTL_MS = 5 * 60 * 1000;

export type GallerySettings = Record<string, string>;

type CacheEntry = {
    expiresAt: number;
    value: GallerySettings;
};

let cache: CacheEntry | null = null;
let generation = 0;
let pending: { generation: number; promise: Promise<GallerySettings> } | null = null;

async function loadGallerySettings(): Promise<GallerySettings> {
    const rows = await galleryAll<{ key: string; value: string }>(
        "SELECT key, value FROM gallery_settings WHERE key IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["contact_whatsapp_url", "contact_whatsapp_message", "request_more_whatsapp_message", "addon_discount_rules", "tutorial_before_drive_file_id", "tutorial_after_drive_file_id", "tutorial_before_2_drive_file_id", "tutorial_after_2_drive_file_id", "tutorial_before_3_drive_file_id", "tutorial_after_3_drive_file_id", "tutorial_preview_version"],
    );
    return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
}

export async function getGallerySettings(): Promise<GallerySettings> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.value;
    if (pending?.generation === generation) return pending.promise;

    const loadGeneration = generation;
    const promise = loadGallerySettings()
        .then((value) => {
            if (generation === loadGeneration) {
                cache = { value, expiresAt: Date.now() + GALLERY_SETTINGS_TTL_MS };
            }
            return value;
        })
        .finally(() => {
            if (pending?.promise === promise) pending = null;
        });
    pending = { generation: loadGeneration, promise };

    return promise;
}

export async function getFreshGallerySettings(): Promise<GallerySettings> {
    return loadGallerySettings();
}

export function invalidateGallerySettingsCache(): void {
    generation += 1;
    cache = null;
    pending = null;
}
