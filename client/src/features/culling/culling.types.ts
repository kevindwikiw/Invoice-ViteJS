// File: src/features/culling/culling.types.ts

export type GalleryStatus = 'draft' | 'open' | 'closed';
export type AddonStatus = 'none' | 'pending' | 'quoted' | 'approved' | 'paid' | 'completed' | 'cancelled';
export type AddonPricingMode = 'per_photo' | 'package';

// Tambahkan interface untuk aturan diskon dari backend
export interface DiscountRule {
    minCount: number;
    discountPercent: number;
}

export interface GallerySummary {
    id: number;
    publicKey?: string | null;
    title: string;
    driveFolderId: string;
    status: GalleryStatus;
    createdAt: string;
    updatedAt: string;
    syncedAt?: string | null;
    photoCount: number;
    selectionCount: number;
    selectionDurationHours: number;
    selectionDurationDays: number;
    selectionDeadlineAt?: string | null;
    isExpired?: boolean;
    serverTime?: string;
    tutorialBeforeDriveFileId?: string | null;
    tutorialAfterDriveFileId?: string | null;
    tutorialBefore2DriveFileId?: string | null;
    tutorialAfter2DriveFileId?: string | null;
    tutorialBefore3DriveFileId?: string | null;
    tutorialAfter3DriveFileId?: string | null;
    contactWhatsappUrl?: string | null;
    maxSelections?: number;
    additionalLimit?: number;
    addon?: { 
        enabled: boolean; 
        qrisEnabled?: boolean;
        additionalLimit: number; 
        pricingMode?: string | null; 
        unitPrice?: number | null; 
        status?: string;
        discountRules?: DiscountRule[]; // <-- Aturan diskon dinamis dari backend
    };
    addonStatus?: string;
    editResultsFolderId?: string | null;
    editResultsZipFileId?: string | null;
    comparisonEnabled?: boolean;
    comparisonPairs?: EditResultPair[];
    editResultsPublishedAt?: string | null;
    editResultsPhotoCount?: number;
    hasEditResults?: boolean;
}

export interface GalleryDisplayPhoto {
    driveFileId: string;
    filename: string;
    width?: number | null;
    height?: number | null;
    displayOrder: number;
    photoToken?: string;
}

export interface GalleryPhoto extends GalleryDisplayPhoto {
    id: number;
    galleryId: number;
    mimeType: string;
    createdAt: string;
}

export interface GallerySelection {
    id: number;
    galleryId: number;
    selectedDriveFileId: string;
    selectedFilename: string;
    clientLabel?: string;
    displayOrder?: number | null;
    note?: string | null;
    submittedAt: string;
}

export interface GalleryDetail {
    gallery: GallerySummary;
    photos: GalleryPhoto[];
    selections: GallerySelection[];
}

export interface GalleryListResponse {
    items: GallerySummary[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

export interface EditPackage { id: number; name: string; includedPhotoCount: number; price: number; active: boolean; createdAt: string; updatedAt: string; }
export interface AddonRequest { id: number; galleryId: number; galleryTitle: string; requestedAdditionalCount: number; pricingMode: AddonPricingMode; packageId?: number | null; unitPrice?: number | null; quotedTotal?: number | null; status: AddonStatus; clientNote?: string | null; adminNote?: string | null; createdAt: string; updatedAt?: string; }
export interface Paginated<T> { items?: T[]; packages?: T[]; requests?: T[]; page: number; pageSize: number; total: number; totalPages: number; }

export interface PublicGallery {
    id: number;
    title: string;
    status: GalleryStatus;
    syncedAt?: string | null;
    photoCount?: number;
    selectionCount?: number;
    selectionDurationHours: number;
    selectionDurationDays: number;
    selectionDeadlineAt?: string | null;
    isExpired?: boolean;
    serverTime?: string;
    maxSelections?: number;
    additionalLimit?: number;
    addon?: { 
        enabled: boolean; 
        qrisEnabled?: boolean;
        additionalLimit: number; 
        pricingMode?: string | null; 
        unitPrice?: number | null; 
        status?: string;
        discountRules?: DiscountRule[]; // <-- Aturan diskon dinamis dari backend
    };
    hasEditResults?: boolean;
    tutorialSampleSlots?: number[];
}

export interface EditResultPhoto extends GalleryDisplayPhoto {
    mimeType: string;
    thumbnailUrl: string;
    previewUrl: string;
    downloadUrl: string;
    comparison?: { thumbnailUrl: string; previewUrl: string } | null;
}

export type EditResultPair = { editedDriveFileId: string; beforeDriveFileId: string };
export type PairingPhoto = { driveFileId: string; filename: string; thumbnailUrl: string | null; width?: number | null; height?: number | null };
export type EditResultPairing = { comparisonEnabled: boolean; comparisonPairs: EditResultPair[]; submitted: PairingPhoto[]; edited: PairingPhoto[] };

export interface EditResults {
    photos: EditResultPhoto[];
    publishedAt: string;
    archive: { filename: string; downloadUrl: string } | null;
}

export interface PublicGalleryPhotos {
    gallery: PublicGallery;
    photos: GalleryPhoto[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    selectedDriveFileIds?: string[];
    selectedPhotos: Array<GalleryPhoto & { note?: string | null }>;
}

export interface PublicGalleryPhotoManifest {
    gallery: PublicGallery;
    photos: GalleryPhoto[];
    total: number;
}
