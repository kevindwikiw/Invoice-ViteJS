import type { GalleryPhoto } from '../culling.types';

export type GalleryTheme = 'black' | 'white';

export type GalleryContactSettings = {
    contactWhatsappUrl?: string;
    message?: string;
    requestMoreMessage?: string;
};

export type SelectedPhotoMeta = Pick<
    GalleryPhoto,
    'id' | 'galleryId' | 'driveFileId' | 'filename' | 'mimeType' | 'width' | 'height' | 'displayOrder' | 'createdAt' | 'photoToken'
> & {
    selectedAt: number;
};

