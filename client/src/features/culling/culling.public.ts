// File: src/features/culling/culling.public.ts

import { apiFetch, apiUrl } from '../../lib/api';
import type { PublicGallery, PublicGalleryPhotos, DiscountRule } from './culling.types';

// 1. Fungsi penangkap error (digunakan oleh public dan admin)
export class GalleryApiError extends Error {
    code?: string;
    contactUrl?: string | null;
    status?: number;
}

export async function parseError(response: Response, fallback: string): Promise<Error> {
    const data = await response.json().catch(() => null) as { error?: string; code?: string; contactUrl?: string | null } | null;
    const error = new GalleryApiError(data?.error || fallback);
    error.code = data?.code;
    error.contactUrl = data?.contactUrl;
    error.status = response.status;
    return error;
}

// 2. Logika Diskon yang Dinamis
export function calculateAddonQuote(count: number, unitPrice: number, rules?: DiscountRule[]) {
    let discountPercent = 0;
    
    // Jika backend mengirimkan aturan diskon, cari diskon terbesar yang memenuhi syarat jumlah foto (count)
    if (rules && rules.length > 0) {
        // Urutkan dari jumlah foto terbanyak ke paling sedikit
        const sortedRules = [...rules].sort((a, b) => b.minCount - a.minCount);
        
        for (const rule of sortedRules) {
            if (count >= rule.minCount) {
                discountPercent = rule.discountPercent;
                break; // Berhenti di diskon pertama yang cocok (karena sudah diurutkan dari yang terbesar)
            }
        }
    }

    const normalTotal = count * unitPrice;
    const total = Math.round(normalTotal * (1 - discountPercent / 100));
    return { discountPercent, normalTotal, total, savings: normalTotal - total };
}

// 3. API Klien Publik
export async function verifyGalleryPin(id: string, pin: string): Promise<{ token: string; expiresIn: number; gallery: PublicGallery }> {
    const response = await apiFetch(`/public/galleries/${id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
    });
    if (!response.ok) throw await parseError(response, 'Unable to unlock gallery.');
    return response.json();
}

export async function getPublicGalleryPhotos(id: string, token: string, page = 1, pageSize = 60, includeSelectedPhotos = false, includeSelections = false): Promise<PublicGalleryPhotos> {
    const params = new URLSearchParams({
        token,
        page: String(page),
        pageSize: String(pageSize),
    });
    if (includeSelectedPhotos) params.set('includeSelectedPhotos', '1');
    if (includeSelections) params.set('includeSelections', '1');
    const response = await apiFetch(`/public/galleries/${id}/photos?${params.toString()}`);
    if (!response.ok) throw await parseError(response, 'Unable to load gallery photos.');
    return response.json();
}

export async function submitGallerySelections(id: string, token: string, selections: Array<{ driveFileId: string; note: string }>): Promise<{ status: string; selectionCount: number; filenames: string[] }> {
    const response = await apiFetch(`/public/galleries/${id}/selections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gallery-token': token },
        body: JSON.stringify({ selections }),
    });
    if (!response.ok) throw await parseError(response, 'Unable to submit selections.');
    return response.json();
}

export function galleryThumbnailUrl(galleryId: string | number, driveFileId: string, token: string, photoToken?: string): string {
    const params = new URLSearchParams({ token });
    if (photoToken) params.set('pt', photoToken);
    return apiUrl(`/public/galleries/${galleryId}/photos/${encodeURIComponent(driveFileId)}/thumbnail?${params.toString()}`);
}

export function galleryContentUrl(galleryId: string | number, driveFileId: string, token: string, photoToken?: string): string {
    const params = new URLSearchParams({ token });
    if (photoToken) params.set('pt', photoToken);
    return apiUrl(`/public/galleries/${galleryId}/photos/${encodeURIComponent(driveFileId)}/content?${params.toString()}`);
}

export function galleryPreviewUrl(galleryId: string | number, driveFileId: string, token: string, photoToken?: string): string {
    const params = new URLSearchParams({ token });
    if (photoToken) params.set('pt', photoToken);
    return apiUrl(`/public/galleries/${galleryId}/photos/${encodeURIComponent(driveFileId)}/preview?${params.toString()}`);
}
