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
    contactWhatsappUrl?: string | null;
    maxSelections?: number;
    additionalLimit?: number;
    addon?: { 
        enabled: boolean; 
        additionalLimit: number; 
        pricingMode?: string | null; 
        unitPrice?: number | null; 
        status?: string;
        discountRules?: DiscountRule[]; // <-- Aturan diskon dinamis dari backend
    };
    addonStatus?: string;
}

export interface GalleryPhoto {
    id: number;
    galleryId: number;
    driveFileId: string;
    filename: string;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    displayOrder: number;
    createdAt: string;
    photoToken?: string;
}

export interface GallerySelection {
    id: number;
    galleryId: number;
    selectedDriveFileId: string;
    selectedFilename: string;
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
        additionalLimit: number; 
        pricingMode?: string | null; 
        unitPrice?: number | null; 
        status?: string;
        discountRules?: DiscountRule[]; // <-- Aturan diskon dinamis dari backend
    };
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
