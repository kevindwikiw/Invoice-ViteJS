import { galleryAll, galleryOne, galleryRun } from "../db/galleries";
import { faceSourceVersion, type FaceSourcePhoto } from "./face-model";

export type FaceSourceScope = 'selection' | 'edited';
const pending = new Map<string, Promise<string | null>>();

export class FaceSourceChanged extends Error {
    constructor() { super("Gallery photos changed while preparing face search."); }
}

export async function getFaceSourceVersion(galleryId: number, scope: FaceSourceScope = 'selection'): Promise<string | null> {
    const key = `${galleryId}:${scope}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = resolveSource(galleryId, scope);
    pending.set(key, operation);
    try { return await operation; }
    finally { pending.delete(key); }
}

async function resolveSource(galleryId: number, scope: FaceSourceScope): Promise<string | null> {
    const column = scope === 'edited' ? 'edited_face_source' : 'face_source';
    const table = scope === 'edited' ? 'gallery_edit_result_photos' : 'gallery_photos';
    for (let attempt = 0; attempt < 3; attempt++) {
        const header = await galleryOne<{ version: string | null; revision: number }>(
            `SELECT ${column}_version AS version, ${column}_revision AS revision FROM galleries WHERE id = ?`, [galleryId],
        );
        if (!header) return null;
        if (header.version !== null) return header.version;
        const photos = await galleryAll<FaceSourcePhoto>(`
            SELECT drive_file_id AS "driveFileId", source_version AS "sourceVersion", ${scope === 'edited' ? "''" : 'created_at'} AS "createdAt", width, height
            FROM ${table} WHERE gallery_id = ? ${scope === 'edited' ? "AND mime_type LIKE 'image/%'" : ''}
        `, [galleryId]);
        const version = faceSourceVersion(photos);
        const result = await galleryRun(`
            UPDATE galleries SET ${column}_version = ?
            WHERE id = ? AND ${column}_revision = ?
        `, [version, galleryId, header.revision]);
        if (result.changes) return version;
    }
    throw new FaceSourceChanged();
}
