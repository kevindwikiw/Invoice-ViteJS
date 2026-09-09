import type { GalleryPhoto } from '../culling.types';
import type { GalleryTheme, SelectedPhotoMeta } from './types';

export function tokenKey(galleryId: string): string {
    return `orbit_culling_token_${galleryId}`;
}

export function draftKey(galleryId: string): string {
    return `orbit_culling_selected_${galleryId}`;
}

export function selectedPhotoMetaKey(galleryId: string): string {
    return `orbit_culling_selected_photo_meta_${galleryId}`;
}

export function tutorialKey(galleryId: string): string {
    return `orbit_culling_tutorial_${galleryId}`;
}

export function galleryThemeKey(galleryId: string): string {
    return `orbit_culling_theme_${galleryId}`;
}

export function readGalleryTheme(galleryId: string): GalleryTheme {
    return localStorage.getItem(galleryThemeKey(galleryId)) === 'white' ? 'white' : 'black';
}

export function readSelectionDraft(galleryId: string): string[] {
    try {
        const raw = localStorage.getItem(draftKey(galleryId));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

export function photoToSelectedMeta(photo: GalleryPhoto, selectedAt = Date.now()): SelectedPhotoMeta {
    return {
        id: Number(photo.id || 0),
        galleryId: Number(photo.galleryId || 0),
        driveFileId: photo.driveFileId,
        filename: photo.filename || 'Selected photo',
        mimeType: photo.mimeType || 'image/jpeg',
        width: photo.width ?? null,
        height: photo.height ?? null,
        displayOrder: Number.isFinite(Number(photo.displayOrder)) ? Number(photo.displayOrder) : Number.MAX_SAFE_INTEGER,
        createdAt: photo.createdAt || '',
        photoToken: photo.photoToken,
        selectedAt,
    };
}

export function selectedMetaToPhoto(meta: SelectedPhotoMeta): GalleryPhoto {
    return {
        id: meta.id,
        galleryId: meta.galleryId,
        driveFileId: meta.driveFileId,
        filename: meta.filename,
        mimeType: meta.mimeType,
        width: meta.width,
        height: meta.height,
        displayOrder: meta.displayOrder,
        createdAt: meta.createdAt,
        photoToken: meta.photoToken,
    };
}

export function sameSelectedPhotoMeta(left?: SelectedPhotoMeta, right?: SelectedPhotoMeta): boolean {
    if (!left || !right) return left === right;
    return left.id === right.id
        && left.galleryId === right.galleryId
        && left.driveFileId === right.driveFileId
        && left.filename === right.filename
        && left.mimeType === right.mimeType
        && left.width === right.width
        && left.height === right.height
        && left.displayOrder === right.displayOrder
        && left.createdAt === right.createdAt
        && left.photoToken === right.photoToken
        && left.selectedAt === right.selectedAt;
}

export function readSelectedPhotoMetaDraft(galleryId: string): Record<string, SelectedPhotoMeta> {
    try {
        const parsed = JSON.parse(localStorage.getItem(selectedPhotoMetaKey(galleryId)) || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        const metaById: Record<string, SelectedPhotoMeta> = {};
        for (const value of Object.values(parsed as Record<string, unknown>)) {
            if (!value || typeof value !== 'object') continue;
            const item = value as Partial<SelectedPhotoMeta>;
            if (typeof item.driveFileId !== 'string' || !item.driveFileId) continue;
            metaById[item.driveFileId] = {
                id: Number(item.id || 0),
                galleryId: Number(item.galleryId || 0),
                driveFileId: item.driveFileId,
                filename: typeof item.filename === 'string' && item.filename ? item.filename : 'Selected photo',
                mimeType: typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'image/jpeg',
                width: typeof item.width === 'number' ? item.width : null,
                height: typeof item.height === 'number' ? item.height : null,
                displayOrder: Number.isFinite(Number(item.displayOrder)) ? Number(item.displayOrder) : Number.MAX_SAFE_INTEGER,
                createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
                photoToken: typeof item.photoToken === 'string' ? item.photoToken : undefined,
                selectedAt: Number.isFinite(Number(item.selectedAt)) ? Number(item.selectedAt) : Date.now(),
            };
        }
        return metaById;
    } catch {
        return {};
    }
}

export function pruneSelectedPhotoMeta(metaById: Record<string, SelectedPhotoMeta>, selectedDriveFileIds: string[]): Record<string, SelectedPhotoMeta> {
    const selectedSet = new Set(selectedDriveFileIds);
    const pruned: Record<string, SelectedPhotoMeta> = {};
    for (const driveFileId of selectedDriveFileIds) {
        const meta = metaById[driveFileId];
        if (meta && selectedSet.has(meta.driveFileId)) pruned[driveFileId] = meta;
    }
    return pruned;
}

