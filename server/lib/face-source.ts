import { galleryAll, galleryOne, galleryRun } from "../db/galleries";
import { faceSourceVersion, type FaceSourcePhoto } from "./face-model";

const pending = new Map<number, Promise<string | null>>();

export class FaceSourceChanged extends Error {
    constructor() { super("Gallery photos changed while preparing face search."); }
}

export async function getFaceSourceVersion(galleryId: number): Promise<string | null> {
    const existing = pending.get(galleryId);
    if (existing) return existing;
    const operation = resolveSource(galleryId);
    pending.set(galleryId, operation);
    try { return await operation; }
    finally { pending.delete(galleryId); }
}

async function resolveSource(galleryId: number): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const header = await galleryOne<{ version: string | null; revision: number }>(
            "SELECT face_source_version AS version, face_source_revision AS revision FROM galleries WHERE id = ?", [galleryId],
        );
        if (!header) return null;
        if (header.version !== null) return header.version;
        const photos = await galleryAll<FaceSourcePhoto>(`
            SELECT drive_file_id AS "driveFileId", source_version AS "sourceVersion", created_at AS "createdAt", width, height
            FROM gallery_photos WHERE gallery_id = ?
        `, [galleryId]);
        const version = faceSourceVersion(photos);
        const result = await galleryRun(`
            UPDATE galleries SET face_source_version = ?
            WHERE id = ? AND face_source_revision = ?
        `, [version, galleryId, header.revision]);
        if (result.changes) return version;
    }
    throw new FaceSourceChanged();
}
