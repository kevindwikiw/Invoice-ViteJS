import type { GalleryPhoto } from '../culling.types';

export function displayPhotoLabel(galleryTitle: string | null | undefined, displayIndex: number): string {
    const title = galleryTitle?.trim() || 'Photo';
    return `${title} ${String(displayIndex + 1).padStart(2, '0')}`;
}

export function photoDisplayIndex(photo: GalleryPhoto, fallbackIndex: number): number {
    const displayOrder = Number(photo.displayOrder);
    return Number.isFinite(displayOrder) && displayOrder >= 0 && displayOrder < Number.MAX_SAFE_INTEGER
        ? displayOrder
        : fallbackIndex;
}

