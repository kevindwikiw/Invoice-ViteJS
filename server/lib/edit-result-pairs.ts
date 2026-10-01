import { galleryAll, galleryOne } from "../db/galleries";

export type EditResultPair = { editedDriveFileId: string; beforeDriveFileId: string };
export type BeforePhoto = { driveFileId: string; filename: string; mimeType: string; thumbnailUrl: string | null; width: number | null; height: number | null };

export async function submittedComparisonPhotos(galleryId: number): Promise<BeforePhoto[]> {
    return galleryAll<BeforePhoto>(`SELECT p.drive_file_id as "driveFileId", p.filename,
        p.mime_type as "mimeType", p.thumbnail_url as "thumbnailUrl", p.width, p.height
        FROM gallery_selections s JOIN gallery_photos p
        ON p.gallery_id = s.gallery_id AND p.drive_file_id = s.selected_drive_file_id
        WHERE s.gallery_id = ? ORDER BY p.display_order, p.filename, p.drive_file_id`, [galleryId]);
}

export async function comparisonDraft(galleryId: number) {
    const config = await galleryOne<{ enabled: number }>("SELECT edit_results_comparison_enabled as enabled FROM galleries WHERE id = ?", [galleryId]);
    const pairs = await galleryAll<EditResultPair>('SELECT edited_drive_file_id as "editedDriveFileId", before_drive_file_id as "beforeDriveFileId" FROM gallery_edit_result_pairs WHERE gallery_id = ?', [galleryId]);
    return { comparisonEnabled: Boolean(config?.enabled), comparisonPairs: pairs };
}

export function parseComparisonPairs(value: unknown): EditResultPair[] {
    if (!Array.isArray(value) || value.length > 5000) throw new Error("Invalid comparison pairs.");
    const seen = new Set<string>();
    return value.map((pair) => {
        if (!pair || typeof pair.editedDriveFileId !== "string" || typeof pair.beforeDriveFileId !== "string"
            || !/^[\w-]{1,200}$/.test(pair.editedDriveFileId) || !/^[\w-]{1,200}$/.test(pair.beforeDriveFileId)
            || seen.has(pair.editedDriveFileId)) throw new Error("Each edited photo must have at most one valid before photo.");
        seen.add(pair.editedDriveFileId);
        return { editedDriveFileId: pair.editedDriveFileId, beforeDriveFileId: pair.beforeDriveFileId };
    });
}

export function validComparisonPairs(pairs: EditResultPair[], editedIds: Set<string>, beforeIds: Set<string>) {
    return pairs.filter((pair) => editedIds.has(pair.editedDriveFileId) && beforeIds.has(pair.beforeDriveFileId));
}

export function readBeforePhoto(value: unknown): BeforePhoto | null {
    if (typeof value !== "string") return null;
    try {
        const photo = JSON.parse(value) as BeforePhoto;
        return photo && typeof photo.driveFileId === "string" && typeof photo.mimeType === "string" ? photo : null;
    } catch { return null; }
}
