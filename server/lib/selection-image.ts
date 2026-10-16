import { galleryRun } from "../db/galleries";
import { fetchDriveFile, getDrivePhotoMetadata } from "./google-drive";

type SelectionImage = { galleryId: number; driveFileId: string; thumbnailUrl?: string | null };
type ThumbnailEntry = { url: string; expiresAt: number };

const THUMBNAIL_CACHE_LIMIT = 512;
const THUMBNAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const refreshedThumbnails = new Map<string, ThumbnailEntry>();
const pendingRefreshes = new Map<string, Promise<string>>();

function cachedThumbnail(key: string): string | undefined {
    const entry = refreshedThumbnails.get(key);
    if (!entry) return;
    refreshedThumbnails.delete(key);
    if (entry.expiresAt <= Date.now()) return;
    refreshedThumbnails.set(key, entry);
    return entry.url;
}

async function refreshThumbnail(photo: SelectionImage, key: string, failedUrl?: string): Promise<string> {
    const cached = cachedThumbnail(key);
    if (cached && cached !== failedUrl) return cached;
    const pending = pendingRefreshes.get(key);
    if (pending) return pending;

    const operation = (async () => {
        const metadata = await getDrivePhotoMetadata(photo.driveFileId, { timeoutMs: 5_000, maxAttempts: 1 });
        if (!metadata.thumbnailLink) throw new Error("Google Drive did not return a thumbnail for this photo.");
        // Old signed photo tokens retain their old URL. Repair storage without overwriting a later sync.
        await galleryRun(`UPDATE gallery_photos SET thumbnail_url = ?, web_view_url = ?
            WHERE gallery_id = ? AND drive_file_id = ? AND (thumbnail_url IN (?, ?) OR (thumbnail_url IS NULL AND ? IS NULL))`,
        [metadata.thumbnailLink, metadata.webViewLink || null, photo.galleryId, photo.driveFileId, photo.thumbnailUrl ?? null, failedUrl ?? null, photo.thumbnailUrl ?? null]);
        refreshedThumbnails.set(key, { url: metadata.thumbnailLink, expiresAt: Date.now() + THUMBNAIL_CACHE_TTL_MS });
        while (refreshedThumbnails.size > THUMBNAIL_CACHE_LIMIT) {
            refreshedThumbnails.delete(refreshedThumbnails.keys().next().value!);
        }
        return metadata.thumbnailLink;
    })();
    pendingRefreshes.set(key, operation);
    try { return await operation; }
    finally { if (pendingRefreshes.get(key) === operation) pendingRefreshes.delete(key); }
}

export async function fetchSelectionImage(photo: SelectionImage, width: 320 | 1600): Promise<Response> {
    const key = JSON.stringify([photo.galleryId, photo.driveFileId, photo.thumbnailUrl ?? null]);
    const thumbnail = cachedThumbnail(key) || photo.thumbnailUrl || undefined;
    if (thumbnail) {
        try { return await fetchDriveFile(photo.driveFileId, thumbnail, width, width === 1600, { timeoutMs: 5_000, maxAttempts: 1 }); }
        catch (error) {
            const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : null;
            if (status !== 401 && status !== 403 && status !== 404 && status !== 410) throw error;
        }
    }
    const refreshed = await refreshThumbnail(photo, key, thumbnail);
    try { return await fetchDriveFile(photo.driveFileId, refreshed, width, width === 1600, { timeoutMs: 5_000, maxAttempts: 1 }); }
    catch (error) {
        if (refreshedThumbnails.get(key)?.url === refreshed) refreshedThumbnails.delete(key);
        throw error;
    }
}
