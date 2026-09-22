import { createHash } from "node:crypto";

export const FACE_MODEL_VERSION = "opencv-yunet-2023mar-sface-2021dec-1";

export type FaceSourcePhoto = {
    driveFileId: string;
    sourceVersion?: string;
    createdAt: string;
    width?: number | null;
    height?: number | null;
};

export function facePhotoVersion(photo: FaceSourcePhoto): string {
    return photo.sourceVersion || `legacy:${photo.createdAt}:${photo.width || 0}x${photo.height || 0}`;
}

export function faceSourceVersion(photos: FaceSourcePhoto[]): string {
    // Order, gallery edits and expiring thumbnail URLs do not change image content.
    const manifest = photos.map((photo) => [photo.driveFileId, facePhotoVersion(photo)])
        .sort(([a], [b]) => a!.localeCompare(b!));
    return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
