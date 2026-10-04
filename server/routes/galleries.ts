import { Hono, type Context } from "hono";
import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import writeExcelFile from "write-excel-file/node";
import { galleryAll, galleryBatch, galleryInsertReturningId, galleryOne, galleryRun } from "../db/galleries";
import { fetchDriveFile, getDrivePhotoMetadata, hasAnyoneViewerFolderAccess, listDrivePhotos, listDrivePhotoTree, type DriveFolder } from "../lib/google-drive";
import {
    DEFAULT_SELECTION_DURATION_HOURS,
    isSelectionDeadlineExpired,
    parseSelectionDurationHours,
    resolveGalleryDeadlineUpdate,
    selectionDeadlineEpochSeconds,
    selectionDeadlineFromNow,
} from "../lib/gallery-deadline";
import { getGallerySettings, invalidateGallerySettingsCache } from "../lib/gallery-settings-cache";
import { resetGalleryPinAttempts } from "../middleware/rate-limit";
import { hasFeaturePermission } from "../permissions";
import { faceSearchBodyLimit, handlePublicFaceSearch, handlePublicFaceSearchStatus, prepareGalleryFaceIndex } from "./face-index";
import { getFaceSourceVersion } from "../lib/face-source";
import { comparisonDraft, parseComparisonPairs, readBeforePhoto, submittedComparisonPhotos, validComparisonPairs, type BeforePhoto } from "../lib/edit-result-pairs";

type Env = {
    Variables: {
        user?: AuthUser;
        jwtPayload?: AuthUser;
    };
};

const adminGalleriesRouter = new Hono<Env>();
const publicGalleriesRouter = new Hono<Env>();
publicGalleriesRouter.use("/:id/face-search", faceSearchBodyLimit);

const GALLERY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const PHOTO_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_EDIT_RESULTS_ACCESS_DURATION_HOURS = 7 * 24;
const EDIT_RESULTS_TOKEN_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const GALLERY_IMAGE_CACHE_CONTROL = `private, max-age=${GALLERY_TOKEN_TTL_SECONDS}, immutable`;
const DEFAULT_ADDON_UNIT_PRICE = 10_000;
const DEFAULT_CONTACT_MESSAGE = "Halo Kak Admin Orbit\nSaya ingin meminta bantuan untuk membuka client gallery saya yaa.\n\nIni URL saya: {{gallery_url}}\nSaya client dari: {{gallery_title}}\n\nTerima kasih, Kak!";
const DEFAULT_REQUEST_MORE_MESSAGE = "Halo Kak Admin Orbit\nSaya ingin meminta tambahan edited photos.\n\nIni URL saya: {{gallery_url}}\nSaya client dari: {{gallery_title}}\nPilihan saat ini: {{selected_count}} foto\nSaya ingin menambah: {{requested_count}} foto\nPromo: {{promo_label}}\nEstimasi biaya: {{estimated_price}}";
const PUBLIC_KEY_TIME_ZONE = "Asia/Jakarta";

type AuthUser = { sub: number; email: string; name: string; role: string };
type GalleryStatus = "draft" | "open" | "closed";

function editResultsExpiryFromDuration(durationHours: number | null | undefined, publishedAt: string): string | null {
    if (durationHours === null) return null;
    const hours = Number(durationHours || DEFAULT_EDIT_RESULTS_ACCESS_DURATION_HOURS);
    return new Date(new Date(publishedAt).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function editResultsExpired(expiresAt?: string | null): boolean {
    return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
}

function editResultsExpiresIn(expiresAt?: string | null): number | null {
    if (!expiresAt) return null;
    return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
}

type GalleryRow = {
    id: number;
    title: string;
    publicKey?: string | null;
    contactWhatsappUrl?: string | null;
    maxSelections?: number;
    additionalSelectionLimit?: number;
    editAddonStatus?: string;
    editAddonPricingMode?: string | null;
    editAddonPrice?: number | null;
    qrisEnabled?: number | boolean | null;
    driveFolderId: string;
    editResultsFolderId?: string | null;
    editResultsZipFileId?: string | null;
    editResultsKeyHash?: string | null;
    editResultsPublishedAt?: string | null;
    editResultsAccessDurationHours?: number | null;
    editResultsExpiresAt?: string | null;
    editResultsPhotoCount?: number | null;
    editResultsVersion?: number | null;
    editResultsStatus?: GalleryStatus;
    tutorialBeforeDriveFileId?: string | null;
    tutorialAfterDriveFileId?: string | null;
    tutorialBefore2DriveFileId?: string | null;
    tutorialAfter2DriveFileId?: string | null;
    tutorialBefore3DriveFileId?: string | null;
    tutorialAfter3DriveFileId?: string | null;
    pinHash: string;
    accessVersion: number;
    photoCount?: number;
    selectionCount?: number;
    selectionDurationDays?: number;
    selectionDurationHours?: number;
    selectionDeadlineAt?: string | null;
    status: GalleryStatus;
    createdAt: string;
    updatedAt: string;
    syncedAt?: string | null;
};

type PhotoRow = {
    id: number;
    galleryId: number;
    driveFileId: string;
    filename: string;
    mimeType: string;
    thumbnailUrl?: string | null;
    webViewUrl?: string | null;
    width?: number | null;
    height?: number | null;
    displayOrder: number;
    createdAt: string;
};

type SelectionRow = {
    id: number;
    galleryId: number;
    selectedDriveFileId: string;
    selectedFilename: string;
    clientLabel?: string;
    displayOrder?: number | null;
    note?: string | null;
    submittedAt: string;
};

type PhotoTokenPayload = {
    gid: number;
    av: number;
    fid: string;
    thumb?: string;
    mime?: string;
    exp: number;
};

function photoShape(row: PhotoRow & Record<string, unknown>) {
    return {
        id: Number(row.id),
        galleryId: Number(row.galleryId ?? row.gallery_id),
        driveFileId: String(row.driveFileId ?? row.drive_file_id ?? ""),
        filename: String(row.filename || ""),
        mimeType: String(row.mimeType ?? row.mime_type ?? ""),
        thumbnailUrl: row.thumbnailUrl ?? row.thumbnail_url ?? null,
        webViewUrl: row.webViewUrl ?? row.web_view_url ?? null,
        width: row.width == null ? null : Number(row.width),
        height: row.height == null ? null : Number(row.height),
        displayOrder: Number(row.displayOrder ?? row.display_order ?? 0),
        createdAt: String(row.createdAt ?? row.created_at ?? ""),
        ...(row.note !== undefined ? { note: row.note } : {}),
    };
}

function publicPhotoShape(row: PhotoRow & Record<string, unknown>, accessVersion: number, expiresAt?: number) {
    const photo = photoShape(row);
    return {
        ...photo,
        photoToken: createPhotoTokenSync({
            gid: photo.galleryId,
            av: accessVersion,
            fid: photo.driveFileId,
            thumb: typeof photo.thumbnailUrl === "string" ? photo.thumbnailUrl : "",
            mime: photo.mimeType,
            exp: expiresAt ?? Math.floor(Date.now() / 1000) + PHOTO_TOKEN_TTL_SECONDS,
        }),
    };
}

function selectionDriveFileId(row: Record<string, unknown>): string {
    return String(row.selectedDriveFileId ?? row.selected_drive_file_id ?? "");
}

function getUser(c: Context<Env>): AuthUser | undefined {
    return c.get("user") || c.get("jwtPayload");
}

async function requireGalleryAdmin(c: Context<Env>): Promise<Response | null> {
    const user = getUser(c);
    if (!user) return c.json({ error: "Not Authenticated" }, 401);
    if (!await hasFeaturePermission(user, "manage_client_galleries")) return c.json({ error: "Permission Denied" }, 403);
    return null;
}

function normalizeStatus(value: unknown, fallback: GalleryStatus = "draft"): GalleryStatus {
    return value === "open" || value === "closed" || value === "draft" ? value : fallback;
}

function galleryPublicSlug(title: string): string {
    const slug = title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)
        .replace(/-+$/g, "");
    return slug || "gallery";
}

function galleryPublicDateStamp(date = new Date()): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: PUBLIC_KEY_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
    return `${value("year")}${value("month")}${value("day")}`;
}

function createGalleryPublicKey(title: string): string {
    return `${galleryPublicSlug(title)}-${galleryPublicDateStamp()}`;
}

function normalizeAddonStatus(value: unknown): "unpaid" | "paid" {
    return value === "paid" || value === "completed" ? "paid" : "unpaid";
}

function normalizeBooleanFlag(value: unknown, fallback = false): boolean {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    const text = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) return true;
    if (["0", "false", "no", "off"].includes(text)) return false;
    return fallback;
}

function normalizeDriveFolderId(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
        const url = new URL(raw);
        const folderMatch = url.pathname.match(/\/folders\/([^/]+)/);
        if (folderMatch?.[1]) return decodeURIComponent(folderMatch[1]);
        const id = url.searchParams.get("id");
        if (id) return id;
    } catch {
        // The input may already be a folder ID.
    }

    return raw
        .replace(/^https?:\/\/drive\.google\.com\/drive\/folders\//, "")
        .replace(/[?#].*$/, "")
        .replace(/\/.*$/, "")
        .trim();
}

function directDriveDownloadUrl(photo: Awaited<ReturnType<typeof listDrivePhotos>>[number]): string | null {
    if (!photo.webContentLink || photo.copyRequiresWriterPermission || photo.canDownload === false || photo.viewerDownloadRestricted) return null;
    try {
        const url = new URL(photo.webContentLink);
        const googleHost = ["google.com", "googleusercontent.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
        if (url.protocol !== "https:" || !googleHost || url.username || url.password || url.port) return null;
        if (photo.resourceKey && !url.searchParams.has("resourcekey")) url.searchParams.set("resourcekey", photo.resourceKey);
        return url.toString();
    } catch {
        return null;
    }
}

async function isPublicDriveDownload(downloadUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await fetch(downloadUrl, {
            headers: { Range: "bytes=0-0" },
            redirect: "follow",
            signal: controller.signal,
        });
        const hostname = new URL(response.url).hostname;
        const contentType = response.headers.get("content-type")?.toLowerCase() || "";
        await response.body?.cancel().catch(() => undefined);
        return (response.ok || response.status === 206)
            && hostname !== "accounts.google.com"
            && !contentType.includes("text/html");
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeDriveFileId(value: unknown): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;

    try {
        const url = new URL(raw);
        const pathMatch = url.pathname.match(/\/d\/([^/]+)/);
        if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
        const queryId = url.searchParams.get("id");
        if (queryId) return queryId;
    } catch {
        // The input may already be a Drive file ID.
    }

    return raw.replace(/[?#].*$/, "").replace(/^.*\//, "").trim() || null;
}

function editedZipFileId(value: unknown): string | null {
    if (value != null && typeof value !== "string") throw new Error("Invalid ZIP file ID.");
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) {
        const url = new URL(raw);
        if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.username || url.password || url.port) {
            throw new Error("Enter a Google Drive ZIP file URL or file ID.");
        }
        if (!/^\/file\/d\/[^/]+/.test(url.pathname) && !["/open", "/uc"].includes(url.pathname)) {
            throw new Error("Enter a Google Drive file link, not a folder link.");
        }
    }
    const id = normalizeDriveFileId(raw);
    if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || (!/^https:\/\//i.test(raw) && id !== raw)) {
        throw new Error("Enter a valid Google Drive ZIP file URL or file ID.");
    }
    return id;
}

function tutorialSampleFileIds(row: Pick<GalleryRow, 'tutorialBeforeDriveFileId' | 'tutorialAfterDriveFileId' | 'tutorialBefore2DriveFileId' | 'tutorialAfter2DriveFileId' | 'tutorialBefore3DriveFileId' | 'tutorialAfter3DriveFileId'>, slot: number): { before: string | null; after: string | null } {
    if (slot === 1) return { before: row.tutorialBeforeDriveFileId || null, after: row.tutorialAfterDriveFileId || null };
    if (slot === 2) return { before: row.tutorialBefore2DriveFileId || null, after: row.tutorialAfter2DriveFileId || null };
    if (slot === 3) return { before: row.tutorialBefore3DriveFileId || null, after: row.tutorialAfter3DriveFileId || null };
    return { before: null, after: null };
}

function tutorialSampleSlots(row: Pick<GalleryRow, 'tutorialBeforeDriveFileId' | 'tutorialAfterDriveFileId' | 'tutorialBefore2DriveFileId' | 'tutorialAfter2DriveFileId' | 'tutorialBefore3DriveFileId' | 'tutorialAfter3DriveFileId'>): number[] {
    return [1, 2, 3].filter((slot) => {
        const sample = tutorialSampleFileIds(row, slot);
        return Boolean(sample.before && sample.after);
    });
}

function normalizeWhatsappNumber(value: unknown): string | null {
    let phone = String(value || "").replace(/[\s().-]/g, "");
    if (phone.startsWith("https://wa.me/")) phone = phone.slice("https://wa.me/".length);
    if (phone.startsWith("+")) phone = phone.slice(1);
    if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
    return /^628[0-9]{7,13}$/.test(phone) ? phone : null;
}

function galleryContactMessage(template: string, gallery: GalleryRow, requestUrl: string): string {
    const request = new URL(requestUrl);
    return template.replaceAll("{{gallery_url}}", `${request.origin}/culling/${gallery.publicKey || gallery.id}`).replaceAll("{{gallery_title}}", gallery.title);
}

function selectionDurationHoursFromRow(row: Pick<GalleryRow, "selectionDurationHours" | "selectionDurationDays">): number {
    if (row.selectionDurationHours !== undefined && row.selectionDurationHours !== null) {
        return Number(row.selectionDurationHours);
    }
    if (row.selectionDurationDays !== undefined && row.selectionDurationDays !== null) {
        return Number(row.selectionDurationDays) * 24;
    }
    return DEFAULT_SELECTION_DURATION_HOURS;
}

function galleryPublicShape(row: GalleryRow) {
    const addonStatus = normalizeAddonStatus(row.editAddonStatus);
    const addonActive = addonStatus === "paid";
    const qrisEnabled = normalizeBooleanFlag(row.qrisEnabled);
    const isExpired = isSelectionDeadlineExpired(row.selectionDeadlineAt);
    const selectionDurationHours = selectionDurationHoursFromRow(row);
    return {
        id: row.id,
        title: row.title,
        status: isExpired ? "closed" : row.status,
        syncedAt: row.syncedAt || null,
        selectionDurationHours,
        selectionDurationDays: Math.ceil(selectionDurationHours / 24),
        selectionDeadlineAt: row.selectionDeadlineAt || null,
        isExpired,
        serverTime: new Date().toISOString(),
        photoCount: Number(row.photoCount || 0),
        selectionCount: Number(row.selectionCount || 0),
        maxSelections: Number(row.maxSelections || 0),
        additionalLimit: Number(row.additionalSelectionLimit || 0),
        addonStatus,
        addon: { enabled: addonActive, qrisEnabled, additionalLimit: addonActive ? Number(row.additionalSelectionLimit || 0) : 0, pricingMode: row.editAddonPricingMode || "per_photo", unitPrice: Number(row.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE), status: addonStatus },
        hasEditResults: Number(row.editResultsPhotoCount || 0) > 0,
        tutorialSampleSlots: tutorialSampleSlots(row),
    };
}

function galleryLookup(param: string): { sql: string; params: unknown[] } {
    const numericId = Number(param);
    if (Number.isInteger(numericId) && numericId > 0) {
        return { sql: "id = ? OR public_key = ?", params: [numericId, param] };
    }
    return { sql: "public_key = ?", params: [param] };
}

function galleryAdminShape(row: GalleryRow, counts?: { photoCount?: number; selectionCount?: number }) {
    const addonStatus = normalizeAddonStatus(row.editAddonStatus);
    const qrisEnabled = normalizeBooleanFlag(row.qrisEnabled);
    const isExpired = isSelectionDeadlineExpired(row.selectionDeadlineAt);
    const selectionDurationHours = selectionDurationHoursFromRow(row);
    return {
        id: row.id,
        title: row.title,
        driveFolderId: row.driveFolderId,
        editResultsFolderId: row.editResultsFolderId || null,
        editResultsZipFileId: row.editResultsZipFileId || null,
        editResultsPublishedAt: row.editResultsPublishedAt || null,
        editResultsAccessDurationHours: row.editResultsAccessDurationHours === undefined ? DEFAULT_EDIT_RESULTS_ACCESS_DURATION_HOURS : row.editResultsAccessDurationHours,
        editResultsExpiresAt: row.editResultsExpiresAt || null,
        editResultsPhotoCount: Number(row.editResultsPhotoCount || 0),
        editResultsStatus: row.editResultsStatus === "open" && editResultsExpired(row.editResultsExpiresAt) ? "closed" : row.editResultsStatus || "draft",
        editResultsIsExpired: editResultsExpired(row.editResultsExpiresAt),
        hasEditResults: Number(row.editResultsPhotoCount || 0) > 0,
        publicKey: row.publicKey || String(row.id),
        status: isExpired ? "closed" : row.status,
        selectionDurationHours,
        selectionDurationDays: Math.ceil(selectionDurationHours / 24),
        selectionDeadlineAt: row.selectionDeadlineAt || null,
        isExpired,
        tutorialBeforeDriveFileId: row.tutorialBeforeDriveFileId || null,
        tutorialAfterDriveFileId: row.tutorialAfterDriveFileId || null,
        tutorialBefore2DriveFileId: row.tutorialBefore2DriveFileId || null,
        tutorialAfter2DriveFileId: row.tutorialAfter2DriveFileId || null,
        tutorialBefore3DriveFileId: row.tutorialBefore3DriveFileId || null,
        tutorialAfter3DriveFileId: row.tutorialAfter3DriveFileId || null,
        serverTime: new Date().toISOString(),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        syncedAt: row.syncedAt || null,
        photoCount: Number(counts?.photoCount ?? row.photoCount ?? 0),
        selectionCount: Number(counts?.selectionCount ?? row.selectionCount ?? 0),
        maxSelections: Number(row.maxSelections || 0),
        additionalLimit: Number(row.additionalSelectionLimit || 0),
        addonStatus,
        addon: { enabled: addonStatus === "paid", qrisEnabled, additionalLimit: Number(row.additionalSelectionLimit || 0), pricingMode: row.editAddonPricingMode || "per_photo", unitPrice: Number(row.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE) },
    };
}

function base64Url(input: string | ArrayBuffer): string {
    const buffer = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
}

async function hmac(input: string): Promise<string> {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is required.");
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
}

function hmacSync(input: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is required.");
    return createHmac("sha256", secret).update(input).digest("base64url");
}

function createPhotoTokenSync(payload: PhotoTokenPayload): string {
    const encoded = base64Url(JSON.stringify(payload));
    return `${encoded}.${hmacSync(encoded)}`;
}

function verifyPhotoToken(token: string, galleryId: number, accessVersion: number, fileId: string): PhotoTokenPayload | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature || hmacSync(payload) !== signature) return null;
    try {
        const parsed = JSON.parse(fromBase64Url(payload)) as PhotoTokenPayload;
        if (
            parsed.gid !== galleryId
            || parsed.av !== accessVersion
            || parsed.fid !== fileId
            || Number(parsed.exp || 0) <= Math.floor(Date.now() / 1000)
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function verifyStandalonePhotoToken(token: string, fileId: string): PhotoTokenPayload | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature || hmacSync(payload) !== signature) return null;
    try {
        const parsed = JSON.parse(fromBase64Url(payload)) as PhotoTokenPayload;
        if (parsed.fid !== fileId || Number(parsed.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
        return parsed;
    } catch {
        return null;
    }
}

async function createGalleryToken(galleryId: number, accessVersion: number): Promise<string> {
    const payload = base64Url(JSON.stringify({
        gid: galleryId,
        av: accessVersion,
        exp: Math.floor(Date.now() / 1000) + GALLERY_TOKEN_TTL_SECONDS,
    }));
    return `${payload}.${await hmac(payload)}`;
}

async function createEditResultsToken(galleryId: number, version: number, expiresAt: string | null): Promise<string> {
    const publicationExpiry = expiresAt ? Math.floor(Date.parse(expiresAt) / 1000) : null;
    const technicalExpiry = Math.floor(Date.now() / 1000) + EDIT_RESULTS_TOKEN_MAX_TTL_SECONDS;
    const payload = base64Url(JSON.stringify({
        gid: galleryId,
        ev: version,
        scope: "edit-results",
        exp: publicationExpiry === null ? technicalExpiry : Math.min(publicationExpiry, technicalExpiry),
    }));
    return `${payload}.${await hmac(payload)}`;
}

async function verifyEditResultsToken(token: string, galleryId: number, version: number, expiresAt: string | null): Promise<boolean> {
    const [payload, signature] = token.split(".");
    if (!payload || !signature || await hmac(payload) !== signature) return false;
    try {
        const parsed = JSON.parse(fromBase64Url(payload)) as { gid?: number; ev?: number; scope?: string; exp?: number };
        return parsed.gid === galleryId && parsed.ev === version && parsed.scope === "edit-results" && Number(parsed.exp || 0) > Math.floor(Date.now() / 1000) && !editResultsExpired(expiresAt);
    } catch {
        return false;
    }
}

async function verifyGalleryToken(token: string, galleryId: number, accessVersion: number): Promise<boolean> {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    if (await hmac(payload) !== signature) return false;
    try {
        const parsed = JSON.parse(fromBase64Url(payload)) as { gid?: number; av?: number; exp?: number };
        return parsed.gid === galleryId && parsed.av === accessVersion && Number(parsed.exp || 0) > Math.floor(Date.now() / 1000);
    } catch {
        return false;
    }
}

function galleryTokenExpiration(token: string): number | null {
    const [payload] = token.split(".");
    if (!payload) return null;
    try {
        const parsed = JSON.parse(fromBase64Url(payload)) as { exp?: number };
        const expiresAt = Number(parsed.exp || 0);
        return expiresAt > Math.floor(Date.now() / 1000) ? expiresAt : null;
    } catch {
        return null;
    }
}

async function requirePublicGallery(c: Context<Env>): Promise<{ gallery: GalleryRow; token: string } | Response> {
    const identifier = c.req.param("id");
    if (!identifier) return c.json({ error: "Gallery ID is required." }, 400);
    const lookup = galleryLookup(identifier);

    const token = c.req.query("token") || c.req.header("x-gallery-token") || "";
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", tutorial_before_drive_file_id as "tutorialBeforeDriveFileId", tutorial_after_drive_file_id as "tutorialAfterDriveFileId", tutorial_before_2_drive_file_id as "tutorialBefore2DriveFileId", tutorial_after_2_drive_file_id as "tutorialAfter2DriveFileId", tutorial_before_3_drive_file_id as "tutorialBefore3DriveFileId", tutorial_after_3_drive_file_id as "tutorialAfter3DriveFileId", pin_hash as "pinHash", status,
               max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit",
               edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice", qris_enabled as "qrisEnabled",
               edit_results_status as "editResultsStatus", edit_results_photo_count as "editResultsPhotoCount",
               photo_count as "photoCount", selection_count as "selectionCount",
               selection_duration_days as "selectionDurationDays", selection_duration_hours as "selectionDurationHours", selection_deadline_at as "selectionDeadlineAt",
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt", access_version as "accessVersion"
        FROM galleries WHERE ${lookup.sql}
    `, lookup.params);
    if (!gallery) return c.json({ error: "Gallery Not Found" }, 404);
    if (!token || !await verifyGalleryToken(token, gallery.id, gallery.accessVersion)) return c.json({ error: "Gallery access expired. Enter the PIN again." }, 401);
    if (isSelectionDeadlineExpired(gallery.selectionDeadlineAt) || gallery.status !== "open") {
        const expired = isSelectionDeadlineExpired(gallery.selectionDeadlineAt);
        const settings = await getGallerySettings();
        const text = galleryContactMessage(settings.contact_whatsapp_message || DEFAULT_CONTACT_MESSAGE, gallery, c.req.url);
        return c.json({
            error: expired ? "The selection deadline has ended." : "Gallery is not open for selection.",
            code: expired ? "GALLERY_EXPIRED" : "GALLERY_CLOSED",
            contactUrl: settings.contact_whatsapp_url ? `https://wa.me/${settings.contact_whatsapp_url}?text=${encodeURIComponent(text)}` : null,
        }, 403);
    }
    return { gallery, token };
}

function csvEscape(value: string | number | null | undefined): string {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function powershellSingleQuoted(value: string | number | null | undefined): string {
    return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function scriptSafeFilenamePart(value: string): string {
    return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim() || "photo";
}

function galleryPhotoDisplayLabel(galleryTitle: string, displayIndex: number): string {
    return `${galleryTitle.trim() || "Photo"} ${String(displayIndex + 1).padStart(2, "0")}`;
}

function selectionDisplayIndex(row: SelectionRow, fallbackIndex: number): number {
    const displayOrder = Number(row.displayOrder);
    return Number.isFinite(displayOrder) && displayOrder >= 0 ? displayOrder : fallbackIndex;
}

async function photoForImageRequest(c: Context<Env>, gallery: GalleryRow, fileId: string): Promise<PhotoRow | null> {
    const tokenPayload = verifyPhotoToken(c.req.query("pt") || "", gallery.id, gallery.accessVersion, fileId);
    if (tokenPayload) {
        return {
            id: 0,
            galleryId: gallery.id,
            driveFileId: tokenPayload.fid,
            filename: tokenPayload.fid,
            mimeType: tokenPayload.mime || "image/jpeg",
            thumbnailUrl: tokenPayload.thumb || null,
            webViewUrl: null,
            width: null,
            height: null,
            displayOrder: 0,
            createdAt: "",
        };
    }
    return await galleryOne<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? AND drive_file_id = ?
    `, [gallery.id, fileId]);
}

function photoFromImageToken(c: Context<Env>, fileId: string): PhotoRow | null {
    const tokenPayload = verifyStandalonePhotoToken(c.req.query("pt") || "", fileId);
    if (!tokenPayload) return null;
    return {
        id: 0,
        galleryId: tokenPayload.gid,
        driveFileId: tokenPayload.fid,
        filename: tokenPayload.fid,
        mimeType: tokenPayload.mime || "image/jpeg",
        thumbnailUrl: tokenPayload.thumb || null,
        webViewUrl: null,
        width: null,
        height: null,
        displayOrder: 0,
        createdAt: "",
    };
}

adminGalleriesRouter.get("/", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    c.header("Cache-Control", "private, no-store");

    const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") || 10) || 10));
    const page = Math.max(1, Number(c.req.query("page") || 1) || 1);
    const status = normalizeStatus(c.req.query("status"), "draft");
    const hasStatusFilter = c.req.query("status") === "open" || c.req.query("status") === "closed" || c.req.query("status") === "draft";
    const search = String(c.req.query("search") || "").trim().slice(0, 100);
    const editedMode = c.req.query("mode") === "edited";
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (hasStatusFilter) {
        const expired = editedMode
            ? "(g.edit_results_status = 'open' AND g.edit_results_expires_at IS NOT NULL AND datetime(g.edit_results_expires_at) <= datetime('now'))"
            : "(g.selection_deadline_at IS NOT NULL AND datetime(g.selection_deadline_at) <= datetime('now'))";
        const statusColumn = editedMode ? "g.edit_results_status" : "g.status";
        if (status === "closed") {
            conditions.push(`(${statusColumn} = 'closed' OR ${expired})`);
        } else {
            conditions.push(`(${statusColumn} = ? AND NOT ${expired})`);
            params.push(status);
        }
    }
    if (search) {
        conditions.push(`(LOWER(g.title) LIKE LOWER(?) OR LOWER(${editedMode ? "g.edit_results_folder_id" : "g.drive_folder_id"}) LIKE LOWER(?))`);
        const pattern = `%${search}%`;
        params.push(pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = await galleryOne<{ total: number }>(`SELECT COUNT(*) as total FROM galleries g ${where}`, params);
    const total = Number(totalRow?.total || 0);
    const rows = await galleryAll<GalleryRow & { photoCount?: number; selectionCount?: number }>(`
        SELECT g.id, g.title, g.drive_folder_id as "driveFolderId", g.edit_results_folder_id as "editResultsFolderId", g.edit_results_zip_file_id as "editResultsZipFileId", g.edit_results_published_at as "editResultsPublishedAt", g.edit_results_access_duration_hours as "editResultsAccessDurationHours", g.edit_results_expires_at as "editResultsExpiresAt", g.edit_results_status as "editResultsStatus", g.edit_results_photo_count as "editResultsPhotoCount", g.tutorial_before_drive_file_id as "tutorialBeforeDriveFileId", g.tutorial_after_drive_file_id as "tutorialAfterDriveFileId", g.tutorial_before_2_drive_file_id as "tutorialBefore2DriveFileId", g.tutorial_after_2_drive_file_id as "tutorialAfter2DriveFileId", g.tutorial_before_3_drive_file_id as "tutorialBefore3DriveFileId", g.tutorial_after_3_drive_file_id as "tutorialAfter3DriveFileId", g.pin_hash as "pinHash", g.status,
               g.public_key as "publicKey", g.contact_whatsapp_url as "contactWhatsappUrl",
               g.max_selections as "maxSelections", g.additional_selection_limit as "additionalSelectionLimit",
               g.edit_addon_status as "editAddonStatus", g.edit_addon_pricing_mode as "editAddonPricingMode", g.edit_addon_price as "editAddonPrice", g.qris_enabled as "qrisEnabled",
               g.photo_count as "photoCount",
               (SELECT COUNT(*) FROM gallery_selections s WHERE s.gallery_id = g.id) as "selectionCount",
               g.selection_duration_days as "selectionDurationDays", g.selection_duration_hours as "selectionDurationHours", g.selection_deadline_at as "selectionDeadlineAt",
               g.created_at as "createdAt", g.updated_at as "updatedAt", g.synced_at as "syncedAt"
        FROM galleries g
        ${where}
        ORDER BY g.id DESC
        LIMIT ? OFFSET ?
    `, [...params, pageSize, (page - 1) * pageSize]);
    return c.json({
        items: rows.map((row) => galleryAdminShape(row, row)),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
});

adminGalleriesRouter.get("/settings/contact", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const settings = await getGallerySettings();
    const value = settings.contact_whatsapp_url || "";
    return c.json({ contactWhatsappUrl: normalizeWhatsappNumber(value) ? (value.startsWith("https://wa.me/") ? `+${value.slice("https://wa.me/".length)}` : value) : "", message: settings.contact_whatsapp_message || DEFAULT_CONTACT_MESSAGE, requestMoreMessage: settings.request_more_whatsapp_message || DEFAULT_REQUEST_MORE_MESSAGE });
});

adminGalleriesRouter.patch("/settings/contact", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const body = await c.req.json().catch(() => ({}));
    const phone = normalizeWhatsappNumber(body.contactWhatsappUrl);
    const message = String(body.message || "").trim().slice(0, 500);
    const requestMoreMessage = String(body.requestMoreMessage || "").trim().slice(0, 800);
    if (!phone) return c.json({ error: "Enter a valid Indonesian WhatsApp number, for example 081234567890 or +6281234567890" }, 400);
    await galleryBatch([
        { sql: "INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: ["contact_whatsapp_url", phone] },
        { sql: "INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: ["contact_whatsapp_message", message] },
        { sql: "INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: ["request_more_whatsapp_message", requestMoreMessage] },
    ]);
    invalidateGallerySettingsCache();
    return c.json({ contactWhatsappUrl: phone, message, requestMoreMessage });
});

adminGalleriesRouter.get("/packages", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const pageSize = Math.min(10, Math.max(1, Number(c.req.query("pageSize") || 10)));
    const page = Math.max(1, Number(c.req.query("page") || 1));
    const total = Number((await galleryOne<{ total: number }>("SELECT COUNT(*) as total FROM edit_packages"))?.total || 0);
    const packages = await galleryAll("SELECT id, name, included_photo_count as includedPhotoCount, price, active, created_at as createdAt, updated_at as updatedAt FROM edit_packages ORDER BY id DESC LIMIT ? OFFSET ?", [pageSize, (page - 1) * pageSize]);
    return c.json({ packages, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

adminGalleriesRouter.post("/packages", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || "").trim(); const count = Number(body.includedPhotoCount); const price = Number(body.price);
    if (!name || !Number.isInteger(count) || count < 1 || count > 500 || !Number.isFinite(price) || price < 0) return c.json({ error: "Invalid package details." }, 400);
    const id = await galleryInsertReturningId("INSERT INTO edit_packages (name, included_photo_count, price) VALUES (?, ?, ?)", [name, count, price]);
    return c.json({ id, status: "created" }, 201);
});

adminGalleriesRouter.patch("/packages/:id", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("id"));
    const existing = await galleryOne<{ id: number; name: string; includedPhotoCount: number; price: number; active: number }>("SELECT id, name, included_photo_count as includedPhotoCount, price, active FROM edit_packages WHERE id = ?", [id]);
    if (!existing) return c.json({ error: "Package not found." }, 404);
    const body = await c.req.json().catch(() => ({}));
    const name = body.name === undefined ? existing.name : String(body.name || "").trim();
    const count = body.includedPhotoCount === undefined ? existing.includedPhotoCount : Number(body.includedPhotoCount);
    const price = body.price === undefined ? existing.price : Number(body.price);
    const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
    if (!name || !Number.isInteger(count) || count < 1 || count > 500 || !Number.isFinite(price) || price < 0) return c.json({ error: "Invalid package details." }, 400);
    await galleryRun("UPDATE edit_packages SET name = ?, included_photo_count = ?, price = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [name, count, price, active, id]);
    return c.json({ status: "updated" });
});

adminGalleriesRouter.delete("/packages/:id", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("id"));
    const used = await galleryOne<{ total: number }>("SELECT COUNT(*) as total FROM gallery_edit_requests WHERE package_id = ?", [id]);
    if (Number(used?.total || 0) > 0) return c.json({ error: "Package is already used by an add-on request." }, 409);
    await galleryRun("DELETE FROM edit_packages WHERE id = ?", [id]);
    return c.json({ status: "deleted" });
});

adminGalleriesRouter.get("/:id/addon", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("id"));
    const addon = await galleryOne("SELECT additional_selection_limit as additionalLimit, edit_addon_status as status, edit_addon_pricing_mode as pricingMode, edit_addon_price as price, qris_enabled as qrisEnabled, edit_addon_package_id as packageId FROM galleries WHERE id = ?", [id]);
    if (!addon) return c.json({ error: "Gallery not found" }, 404); return c.json({ addon });
});

adminGalleriesRouter.get("/addon-requests", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const pageSize = Math.min(10, Math.max(1, Number(c.req.query("pageSize") || 10))); const page = Math.max(1, Number(c.req.query("page") || 1));
    const total = Number((await galleryOne<{ total: number }>("SELECT COUNT(*) as total FROM gallery_edit_requests"))?.total || 0);
    const requests = await galleryAll("SELECT r.id, r.gallery_id as galleryId, g.title as galleryTitle, r.requested_additional_count as requestedAdditionalCount, r.pricing_mode as pricingMode, r.package_id as packageId, r.unit_price as unitPrice, r.quoted_total as quotedTotal, r.status, r.client_note as clientNote, r.admin_note as adminNote, r.created_at as createdAt, r.updated_at as updatedAt FROM gallery_edit_requests r JOIN galleries g ON g.id = r.gallery_id ORDER BY r.id DESC LIMIT ? OFFSET ?", [pageSize, (page - 1) * pageSize]);
    return c.json({ requests, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

adminGalleriesRouter.post("/:id/addon", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const galleryId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const count = Number(body.requestedAdditionalCount ?? body.additionalSelectionLimit);
    const mode = body.pricingMode === "package" ? "package" : "per_photo";
    const packageId = body.packageId ? Number(body.packageId) : null;
    const unitPrice = body.unitPrice === undefined || body.unitPrice === "" ? null : Number(body.unitPrice);
    const quotedTotal = body.quotedTotal === undefined || body.quotedTotal === "" ? null : Number(body.quotedTotal);
    const status = normalizeAddonStatus(body.status);
    if (!Number.isInteger(count) || count < 0 || count > 500 || (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) || (quotedTotal !== null && (!Number.isFinite(quotedTotal) || quotedTotal < 0))) return c.json({ error: "Invalid add-on details." }, 400);
    const id = await galleryInsertReturningId("INSERT INTO gallery_edit_requests (gallery_id, requested_additional_count, pricing_mode, package_id, unit_price, quoted_total, status, client_note, admin_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [galleryId, count, mode, packageId, unitPrice, quotedTotal, status, String(body.clientNote || "").trim() || null, String(body.adminNote || "").trim() || null]);
    return c.json({ id, status: "created" }, 201);
});

adminGalleriesRouter.patch("/addon-requests/:requestId", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("requestId"));
    const existing = await galleryOne<any>("SELECT * FROM gallery_edit_requests WHERE id = ?", [id]);
    if (!existing) return c.json({ error: "Add-on request not found." }, 404);
    const body = await c.req.json().catch(() => ({}));
    const count = body.requestedAdditionalCount === undefined ? existing.requested_additional_count : Number(body.requestedAdditionalCount);
    const mode = body.pricingMode === "package" ? "package" : (body.pricingMode === "per_photo" ? "per_photo" : existing.pricing_mode);
    const status = body.status === undefined ? normalizeAddonStatus(existing.status) : normalizeAddonStatus(body.status);
    if (!Number.isInteger(count) || count < 0 || count > 500) return c.json({ error: "Invalid add-on request." }, 400);
    await galleryRun("UPDATE gallery_edit_requests SET requested_additional_count = ?, pricing_mode = ?, package_id = ?, unit_price = ?, quoted_total = ?, status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [count, mode, body.packageId ?? existing.package_id ?? null, body.unitPrice ?? existing.unit_price ?? null, body.quotedTotal ?? existing.quoted_total ?? null, status, body.adminNote ?? existing.admin_note ?? null, id]);
    await galleryRun("UPDATE galleries SET additional_selection_limit = ?, edit_addon_status = ?, edit_addon_pricing_mode = ?, edit_addon_price = ?, edit_addon_package_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [count, status, mode, body.unitPrice ?? existing.unit_price ?? null, body.packageId ?? existing.package_id ?? null, existing.gallery_id]);
    return c.json({ status: "updated" });
});

adminGalleriesRouter.post("/:id/addon/approve", async (c) => {
    const denied = await requireGalleryAdmin(c); if (denied) return denied;
    const galleryId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const request = await galleryOne<any>("SELECT * FROM gallery_edit_requests WHERE id = ? AND gallery_id = ?", [requestId, galleryId]);
    if (!request) return c.json({ error: "Add-on request not found." }, 404);
    await galleryRun("UPDATE gallery_edit_requests SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
    await galleryRun("UPDATE galleries SET additional_selection_limit = ?, edit_addon_status = 'paid', edit_addon_pricing_mode = ?, edit_addon_price = ?, edit_addon_package_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [request.requested_additional_count, request.pricing_mode, request.unit_price, request.package_id, galleryId]);
    return c.json({ status: "paid" });
});

adminGalleriesRouter.post("/", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const body = await c.req.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    const driveFolderId = normalizeDriveFolderId(body.driveFolderUrl ?? body.driveFolderId);
    const pin = String(body.pin || "").trim();
    const tutorialBeforeDriveFileId = normalizeDriveFileId(body.tutorialBeforeDriveFileId);
    const tutorialAfterDriveFileId = normalizeDriveFileId(body.tutorialAfterDriveFileId);
    const tutorialBefore2DriveFileId = normalizeDriveFileId(body.tutorialBefore2DriveFileId);
    const tutorialAfter2DriveFileId = normalizeDriveFileId(body.tutorialAfter2DriveFileId);
    const tutorialBefore3DriveFileId = normalizeDriveFileId(body.tutorialBefore3DriveFileId);
    const tutorialAfter3DriveFileId = normalizeDriveFileId(body.tutorialAfter3DriveFileId);
    const status = normalizeStatus(body.status, "draft");
    const maxSelections = Math.min(500, Math.max(0, Number(body.maxSelections ?? 50) || 50));
    const qrisEnabled = normalizeBooleanFlag(body.qrisEnabled);
    const requestedDurationHours = body.selectionDurationHours ?? (body.selectionDurationDays === undefined ? DEFAULT_SELECTION_DURATION_HOURS : Number(body.selectionDurationDays) * 24);
    const selectionDurationHours = parseSelectionDurationHours(requestedDurationHours);
    const selectionDurationDays = selectionDurationHours === null ? null : Math.ceil(selectionDurationHours / 24);

    if (!title || !driveFolderId || pin.length < 4 || selectionDurationHours === null || selectionDurationDays === null) {
        return c.json({ error: "Title, Drive folder ID, a PIN of at least 4 characters, and a selection duration from 1 to 8760 hours are required." }, 400);
    }

    const pinHash = await Bun.password.hash(pin, { algorithm: "bcrypt", cost: 10 });
    const publicKey = createGalleryPublicKey(title);
    const selectionDeadlineAt = selectionDeadlineFromNow(selectionDurationHours);
    const id = await galleryInsertReturningId(
        "INSERT INTO galleries (title, public_key, max_selections, edit_addon_pricing_mode, edit_addon_price, qris_enabled, drive_folder_id, tutorial_before_drive_file_id, tutorial_after_drive_file_id, tutorial_before_2_drive_file_id, tutorial_after_2_drive_file_id, tutorial_before_3_drive_file_id, tutorial_after_3_drive_file_id, pin_hash, selection_duration_days, selection_duration_hours, selection_deadline_at, status) VALUES (?, ?, ?, 'per_photo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [title, publicKey, maxSelections, DEFAULT_ADDON_UNIT_PRICE, qrisEnabled ? 1 : 0, driveFolderId, tutorialBeforeDriveFileId, tutorialAfterDriveFileId, tutorialBefore2DriveFileId, tutorialAfter2DriveFileId, tutorialBefore3DriveFileId, tutorialAfter3DriveFileId, pinHash, selectionDurationDays, selectionDurationHours, selectionDeadlineAt, status],
    );
    const row = await galleryOne<GalleryRow>(`
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", edit_results_folder_id as "editResultsFolderId", edit_results_zip_file_id as "editResultsZipFileId", edit_results_published_at as "editResultsPublishedAt", edit_results_access_duration_hours as "editResultsAccessDurationHours", edit_results_expires_at as "editResultsExpiresAt", edit_results_status as "editResultsStatus", edit_results_photo_count as "editResultsPhotoCount", tutorial_before_drive_file_id as "tutorialBeforeDriveFileId", tutorial_after_drive_file_id as "tutorialAfterDriveFileId", tutorial_before_2_drive_file_id as "tutorialBefore2DriveFileId", tutorial_after_2_drive_file_id as "tutorialAfter2DriveFileId", tutorial_before_3_drive_file_id as "tutorialBefore3DriveFileId", tutorial_after_3_drive_file_id as "tutorialAfter3DriveFileId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice", qris_enabled as "qrisEnabled",
               photo_count as "photoCount", selection_count as "selectionCount", selection_duration_days as "selectionDurationDays", selection_duration_hours as "selectionDurationHours", selection_deadline_at as "selectionDeadlineAt", created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    return c.json(galleryAdminShape(row!));
});

adminGalleriesRouter.get("/:id", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", edit_results_folder_id as "editResultsFolderId", edit_results_zip_file_id as "editResultsZipFileId", edit_results_published_at as "editResultsPublishedAt", edit_results_access_duration_hours as "editResultsAccessDurationHours", edit_results_expires_at as "editResultsExpiresAt", edit_results_status as "editResultsStatus", edit_results_photo_count as "editResultsPhotoCount", tutorial_before_drive_file_id as "tutorialBeforeDriveFileId", tutorial_after_drive_file_id as "tutorialAfterDriveFileId", tutorial_before_2_drive_file_id as "tutorialBefore2DriveFileId", tutorial_after_2_drive_file_id as "tutorialAfter2DriveFileId", tutorial_before_3_drive_file_id as "tutorialBefore3DriveFileId", tutorial_after_3_drive_file_id as "tutorialAfter3DriveFileId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice", qris_enabled as "qrisEnabled",
               photo_count as "photoCount", selection_count as "selectionCount", selection_duration_days as "selectionDurationDays", selection_duration_hours as "selectionDurationHours", selection_deadline_at as "selectionDeadlineAt", created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    const photos = await galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? ORDER BY display_order, filename
    `, [id]);
    const selections = await galleryAll<SelectionRow>(`
        SELECT s.id, s.gallery_id as "galleryId", s.selected_drive_file_id as "selectedDriveFileId",
               s.selected_filename as "selectedFilename", p.display_order as "displayOrder",
               s.note, s.submitted_at as "submittedAt"
        FROM gallery_selections s
        LEFT JOIN gallery_photos p ON p.gallery_id = s.gallery_id AND p.drive_file_id = s.selected_drive_file_id
        WHERE s.gallery_id = ?
        ORDER BY COALESCE(p.display_order, 2147483647), s.selected_filename
    `, [id]);
    return c.json({
        gallery: { ...galleryAdminShape(gallery, { photoCount: photos.length, selectionCount: selections.length }), ...await comparisonDraft(id) },
        photos: photos.map((photo) => photoShape(photo as PhotoRow & Record<string, unknown>)),
        selections: selections.map((selection, index) => ({
            ...selection,
            displayOrder: selection.displayOrder ?? null,
            clientLabel: galleryPhotoDisplayLabel(gallery.title, selectionDisplayIndex(selection, index)),
        })),
    });
});

adminGalleriesRouter.post("/:id/reset-pin-lock", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, public_key as \"publicKey\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    try {
        await resetGalleryPinAttempts([String(gallery.id), gallery.publicKey || ""]);
    } catch {
        return c.json({ error: "Unable to reset PIN attempts. Please try again." }, 503);
    }
    return c.json({ status: "reset" });
});

adminGalleriesRouter.patch("/:id", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const existing = await galleryOne<GalleryRow>(`
        SELECT id, title, contact_whatsapp_url as "contactWhatsappUrl", edit_results_status as "editResultsStatus", edit_results_key_hash as "editResultsKeyHash", edit_results_photo_count as "editResultsPhotoCount", edit_results_expires_at as "editResultsExpiresAt", drive_folder_id as "driveFolderId", edit_results_folder_id as "editResultsFolderId", edit_results_zip_file_id as "editResultsZipFileId", edit_results_access_duration_hours as "editResultsAccessDurationHours", tutorial_before_drive_file_id as "tutorialBeforeDriveFileId", tutorial_after_drive_file_id as "tutorialAfterDriveFileId", tutorial_before_2_drive_file_id as "tutorialBefore2DriveFileId", tutorial_after_2_drive_file_id as "tutorialAfter2DriveFileId", tutorial_before_3_drive_file_id as "tutorialBefore3DriveFileId", tutorial_after_3_drive_file_id as "tutorialAfter3DriveFileId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice", qris_enabled as "qrisEnabled",
               selection_count as "selectionCount", selection_duration_days as "selectionDurationDays", selection_duration_hours as "selectionDurationHours", selection_deadline_at as "selectionDeadlineAt", created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    if (!existing) return c.json({ error: "Gallery not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const title = body.title === undefined ? existing.title : String(body.title || "").trim();
    const driveFolderId = body.driveFolderId === undefined && body.driveFolderUrl === undefined
        ? existing.driveFolderId
        : normalizeDriveFolderId(body.driveFolderUrl ?? body.driveFolderId);
    const editResultsFolderId = body.editResultsFolderId === undefined
        ? existing.editResultsFolderId || null
        : normalizeDriveFolderId(body.editResultsFolderId) || null;
    let editResultsZipFileId = existing.editResultsZipFileId || null;
    if (body.editResultsZipFileId !== undefined) {
        try {
            editResultsZipFileId = editedZipFileId(body.editResultsZipFileId);
        } catch {
            return c.json({ error: "Enter a valid Google Drive ZIP file URL or file ID." }, 400);
        }
    }
    const editedFields = ["editResultsStatus", "editResultsFolderId", "editResultsZipFileId", "editResultsAccessDurationHours", "comparisonEnabled", "comparisonPairs"];
    const changesEdited = editedFields.some((key) => body[key] !== undefined);
    const changesSelection = Object.keys(body).some((key) => !editedFields.includes(key));
    const rawEditDuration = body.editResultsAccessDurationHours;
    const editResultsAccessDurationHours = rawEditDuration === undefined
        ? (existing.editResultsAccessDurationHours === undefined ? DEFAULT_EDIT_RESULTS_ACCESS_DURATION_HOURS : existing.editResultsAccessDurationHours)
        : rawEditDuration === null || rawEditDuration === '' ? null : Number(rawEditDuration);
    if (editResultsAccessDurationHours !== null && (!Number.isInteger(editResultsAccessDurationHours) || editResultsAccessDurationHours < 24 || editResultsAccessDurationHours > 87600 || editResultsAccessDurationHours % 24 !== 0)) {
        return c.json({ error: "Edited photos access duration must be a whole number of days from 1 to 3650, or unlimited." }, 400);
    }
    if (body.editResultsStatus !== undefined && !["draft", "open", "closed"].includes(body.editResultsStatus)) return c.json({ error: "Invalid edited photos status." }, 400);
    const editedStatus = body.editResultsStatus ?? existing.editResultsStatus ?? "draft";
    if (body.editResultsStatus === "open" && (!existing.editResultsKeyHash || !Number(existing.editResultsPhotoCount))) {
        return c.json({ error: "Publish edited photos before opening access.", code: "EDIT_RESULTS_NOT_PUBLISHED" }, 400);
    }
    const reopenEdited = body.editResultsStatus === "open" && (existing.editResultsStatus !== "open" || editResultsExpired(existing.editResultsExpiresAt));
    const editedExpiresAt = reopenEdited ? editResultsExpiryFromDuration(editResultsAccessDurationHours, new Date().toISOString()) : existing.editResultsExpiresAt || null;
    const rotateEditedVersion = editedStatus !== existing.editResultsStatus || reopenEdited;
    const durationWasProvided = body.selectionDurationHours !== undefined || body.selectionDurationDays !== undefined;
    const requestedDurationHours = body.selectionDurationHours ?? (body.selectionDurationDays === undefined ? undefined : Number(body.selectionDurationDays) * 24);
    let deadlineUpdate;
    try {
        deadlineUpdate = !changesSelection ? { selectionDurationHours: selectionDurationHoursFromRow(existing), selectionDeadlineAt: existing.selectionDeadlineAt, status: existing.status } : resolveGalleryDeadlineUpdate({
            existingDurationHours: selectionDurationHoursFromRow(existing),
            existingDeadlineAt: existing.selectionDeadlineAt,
            nextStatus: normalizeStatus(body.status, existing.status),
            requestedStatus: body.status,
            durationWasProvided,
            requestedDurationHours,
        });
    } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Invalid selection deadline." }, 400);
    }
    const { selectionDurationHours, selectionDeadlineAt, status } = deadlineUpdate;
    const selectionDurationDays = Math.ceil(selectionDurationHours / 24);
    const contactWhatsappUrl = body.contactWhatsappUrl === undefined ? existing.contactWhatsappUrl || null : String(body.contactWhatsappUrl || "").trim() || null;
    const maxSelections = body.maxSelections === undefined ? Number(existing.maxSelections || 0) : Math.min(500, Math.max(0, Number(body.maxSelections) || 0));
    const additionalSelectionLimit = body.additionalSelectionLimit === undefined ? Number(existing.additionalSelectionLimit || 0) : Math.min(500, Math.max(0, Number(body.additionalSelectionLimit) || 0));
    const editAddonStatus = body.editAddonStatus === undefined ? normalizeAddonStatus(existing.editAddonStatus) : normalizeAddonStatus(body.editAddonStatus);
    const editAddonPricingMode = body.editAddonPricingMode === undefined ? existing.editAddonPricingMode || "per_photo" : String(body.editAddonPricingMode || "") || "per_photo";
    const editAddonPrice = body.editAddonPrice === undefined ? Number(existing.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE) : Math.max(0, Number(body.editAddonPrice) || 0);
    const qrisEnabled = body.qrisEnabled === undefined ? normalizeBooleanFlag(existing.qrisEnabled) : normalizeBooleanFlag(body.qrisEnabled);
    const tutorialBeforeDriveFileId = body.tutorialBeforeDriveFileId === undefined ? existing.tutorialBeforeDriveFileId || null : normalizeDriveFileId(body.tutorialBeforeDriveFileId);
    const tutorialAfterDriveFileId = body.tutorialAfterDriveFileId === undefined ? existing.tutorialAfterDriveFileId || null : normalizeDriveFileId(body.tutorialAfterDriveFileId);
    const tutorialBefore2DriveFileId = body.tutorialBefore2DriveFileId === undefined ? existing.tutorialBefore2DriveFileId || null : normalizeDriveFileId(body.tutorialBefore2DriveFileId);
    const tutorialAfter2DriveFileId = body.tutorialAfter2DriveFileId === undefined ? existing.tutorialAfter2DriveFileId || null : normalizeDriveFileId(body.tutorialAfter2DriveFileId);
    const tutorialBefore3DriveFileId = body.tutorialBefore3DriveFileId === undefined ? existing.tutorialBefore3DriveFileId || null : normalizeDriveFileId(body.tutorialBefore3DriveFileId);
    const tutorialAfter3DriveFileId = body.tutorialAfter3DriveFileId === undefined ? existing.tutorialAfter3DriveFileId || null : normalizeDriveFileId(body.tutorialAfter3DriveFileId);
    const pin = body.pin === undefined ? "" : String(body.pin || "").trim();
    const pinHash = pin ? await Bun.password.hash(pin, { algorithm: "bcrypt", cost: 10 }) : existing.pinHash;
    const rotateAccessVersion = Boolean(pin)
        || driveFolderId !== existing.driveFolderId
        || status !== existing.status;
    const activeSelectionLimit = maxSelections ? maxSelections + (editAddonStatus === "paid" ? additionalSelectionLimit : 0) : 0;
    const selectionCount = Number(existing.selectionCount || 0);

    if (!title || !driveFolderId) return c.json({ error: "Title and Drive folder ID are required." }, 400);
    if (body.pin !== undefined && pin.length > 0 && pin.length < 4) return c.json({ error: "PIN must be at least 4 characters." }, 400);
    if (changesSelection && activeSelectionLimit && selectionCount > activeSelectionLimit) {
        return c.json({ error: `Active limit cannot be lower than ${selectionCount} submitted selections.` }, 400);
    }

    const comparisonStatements: Array<{ sql: string; params: unknown[] }> = [];
    if (body.comparisonEnabled !== undefined) {
        if (typeof body.comparisonEnabled !== "boolean") return c.json({ error: "Invalid comparison setting." }, 400);
        comparisonStatements.push({ sql: "UPDATE galleries SET edit_results_comparison_enabled = ? WHERE id = ?", params: [body.comparisonEnabled ? 1 : 0, id] });
    }
    if (body.comparisonPairs !== undefined) {
        let pairs;
        try { pairs = parseComparisonPairs(body.comparisonPairs); }
        catch (error) { return c.json({ error: (error as Error).message }, 400); }
        if (pairs.length) {
            if (!editResultsFolderId) return c.json({ error: "Save an edited photos folder first." }, 400);
            try {
                const { photos: edited } = await listDrivePhotoTree(editResultsFolderId);
                const before = await submittedComparisonPhotos(id);
                if (validComparisonPairs(pairs, new Set(edited.map((p) => p.id)), new Set(before.map((p) => p.driveFileId))).length !== pairs.length) {
                    return c.json({ error: "A comparison photo is no longer in this gallery. Refresh Manage Pairs." }, 400);
                }
            } catch { return c.json({ error: "Unable to verify comparison photos. Try again." }, 502); }
        }
        comparisonStatements.push({ sql: "DELETE FROM gallery_edit_result_pairs WHERE gallery_id = ?", params: [id] });
        comparisonStatements.push(...pairs.map((pair) => ({ sql: "INSERT INTO gallery_edit_result_pairs (gallery_id, edited_drive_file_id, before_drive_file_id) VALUES (?, ?, ?)", params: [id, pair.editedDriveFileId, pair.beforeDriveFileId] })));
    }
    const statements: Array<{ sql: string; params: unknown[] }> = [...comparisonStatements];
    if (changesSelection) statements.push({ sql:
        "UPDATE galleries SET title = ?, drive_folder_id = ?, tutorial_before_drive_file_id = ?, tutorial_after_drive_file_id = ?, tutorial_before_2_drive_file_id = ?, tutorial_after_2_drive_file_id = ?, tutorial_before_3_drive_file_id = ?, tutorial_after_3_drive_file_id = ?, pin_hash = ?, contact_whatsapp_url = ?, max_selections = ?, additional_selection_limit = ?, edit_addon_status = ?, edit_addon_pricing_mode = ?, edit_addon_price = ?, qris_enabled = ?, selection_duration_days = ?, selection_duration_hours = ?, selection_deadline_at = ?, status = ?, access_version = access_version + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params: [title, driveFolderId, tutorialBeforeDriveFileId, tutorialAfterDriveFileId, tutorialBefore2DriveFileId, tutorialAfter2DriveFileId, tutorialBefore3DriveFileId, tutorialAfter3DriveFileId, pinHash, contactWhatsappUrl, maxSelections, additionalSelectionLimit, editAddonStatus, editAddonPricingMode, editAddonPrice, qrisEnabled ? 1 : 0, selectionDurationDays, selectionDurationHours, selectionDeadlineAt, status, rotateAccessVersion ? 1 : 0, id],
    });
    if (changesEdited) statements.push({
        sql: "UPDATE galleries SET edit_results_folder_id = ?, edit_results_zip_file_id = ?, edit_results_access_duration_hours = ?, edit_results_status = ?, edit_results_expires_at = ?, edit_results_version = edit_results_version + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params: [editResultsFolderId, editResultsZipFileId, editResultsAccessDurationHours, editedStatus, editedExpiresAt, rotateEditedVersion ? 1 : 0, id],
    });
    if (statements.length) await galleryBatch(statements);
    if (changesSelection && status === "open" && driveFolderId === existing.driveFolderId) void prepareGalleryFaceIndex(id);
    return c.json({ status: "updated" });
});

adminGalleriesRouter.get("/:id/edit-results/pairing", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<{ folder: string | null }>("SELECT edit_results_folder_id as folder FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found." }, 404);
    if (!gallery.folder) return c.json({ error: "Save an edited photos folder first." }, 400);
    try {
        const { photos: edited } = await listDrivePhotoTree(gallery.folder);
        const submitted = await submittedComparisonPhotos(id);
        c.header("Cache-Control", "no-store");
        return c.json({
            ...await comparisonDraft(id),
            submitted: submitted.map((photo) => ({ ...photo, thumbnailUrl: `/api/galleries/${id}/edit-results/pairing/before/${encodeURIComponent(photo.driveFileId)}/thumbnail` })),
            edited: edited.map((photo) => ({ driveFileId: photo.id, filename: photo.name, thumbnailUrl: photo.thumbnailLink || null, width: photo.width, height: photo.height })),
        });
    } catch { return c.json({ error: "Unable to load comparison photos from Drive." }, 502); }
});

adminGalleriesRouter.get("/:id/edit-results/pairing/before/:fileId/thumbnail", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const submitted = await submittedComparisonPhotos(Number(c.req.param("id")));
    const photo = submitted.find((p) => p.driveFileId === c.req.param("fileId"));
    if (!photo) return c.json({ error: "Submitted photo not found." }, 404);
    try {
        const response = await comparisonImage(photo, 320);
        return new Response(response.body, { headers: { "Content-Type": response.headers.get("Content-Type") || photo.mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
    } catch { return c.json({ error: "Unable to load submitted thumbnail." }, 502); }
});

async function comparisonImage(photo: BeforePhoto, width: 320 | 1600): Promise<Response> {
    try {
        if (!photo.thumbnailUrl) throw new Error("Missing thumbnail");
        return await fetchDriveFile(photo.driveFileId, photo.thumbnailUrl, width, true);
    } catch {
        const metadata = await getDrivePhotoMetadata(photo.driveFileId);
        if (!metadata.thumbnailLink) throw new Error("Missing thumbnail");
        return fetchDriveFile(photo.driveFileId, metadata.thumbnailLink, width, true);
    }
}

adminGalleriesRouter.post("/:id/edit-results/publish", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, edit_results_folder_id as \"editResultsFolderId\", edit_results_zip_file_id as \"editResultsZipFileId\", edit_results_access_duration_hours as \"editResultsAccessDurationHours\", edit_results_version as \"editResultsVersion\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    if (!gallery.editResultsFolderId) return c.json({ error: "Set an edited photos Drive folder before publishing." }, 400);
    const body = await c.req.json().catch(() => ({})) as { password?: unknown };
    const password = String(body.password || "").trim();
    if (password.length < 6 || password.length > 64) {
        return c.json({ error: "Edited photos password must be between 6 and 64 characters." }, 400);
    }

    try {
        const publicFolderAccess = await hasAnyoneViewerFolderAccess(gallery.editResultsFolderId);
        if (publicFolderAccess === false) {
            return c.json({ error: "Share the edited photos folder as Anyone with the link · Viewer before publishing." }, 400);
        }
        const { photos, folders } = await listDrivePhotoTree(gallery.editResultsFolderId);
        if (!photos.length) return c.json({ error: "The edited photos folder is empty." }, 400);
        const snapshot = photos.map((photo, index) => ({ photo, downloadUrl: directDriveDownloadUrl(photo), displayOrder: index }));
        let unavailable = snapshot.find(({ downloadUrl }) => !downloadUrl);
        if (!unavailable && publicFolderAccess === null && snapshot.length > 0) {
            const representative = snapshot[0];
            if (representative && (!representative.downloadUrl || !await isPublicDriveDownload(representative.downloadUrl))) {
                unavailable = representative;
            }
        }
        if (unavailable) return c.json({ error: `Google Drive does not allow direct download for ${unavailable.photo.name}. Check its sharing and download restrictions.` }, 400);

        let archive: { filename: string; downloadUrl: string } | null = null;
        if (gallery.editResultsZipFileId) {
            let zip: Awaited<ReturnType<typeof getDrivePhotoMetadata>>;
            try {
                zip = await getDrivePhotoMetadata(gallery.editResultsZipFileId);
            } catch {
                return c.json({ error: "Unable to read the ZIP file. Check the link and Google Drive access." }, 400);
            }
            const zipMimeTypes = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];
            if (!zipMimeTypes.includes(zip.mimeType.toLowerCase()) || !/\.zip$/i.test(zip.name)) {
                return c.json({ error: "Edited Photos ZIP must be a .zip archive." }, 400);
            }
            const downloadUrl = directDriveDownloadUrl(zip);
            if (!downloadUrl || zip.canDownload !== true) {
                return c.json({ error: "Google Drive does not allow this ZIP to be downloaded. Check its sharing and Viewer download permissions." }, 400);
            }
            const publicZipAccess = await hasAnyoneViewerFolderAccess(gallery.editResultsZipFileId);
            if (publicZipAccess === false) {
                return c.json({ error: "Share the ZIP as Anyone with the link - Viewer before publishing." }, 400);
            }
            // Readers cannot always audit permissions. The admin must verify
            // the public link in incognito; never probe the ZIP's binary content.
            archive = { filename: zip.name, downloadUrl };
        }

        const draft = await comparisonDraft(id);
        const beforeByEdited = new Map<string, BeforePhoto>();
        const warnings: string[] = [];
        if (draft.comparisonEnabled) {
            const submitted = await submittedComparisonPhotos(id);
            const valid = validComparisonPairs(draft.comparisonPairs, new Set(photos.map((p) => p.id)), new Set(submitted.map((p) => p.driveFileId)));
            const beforeIds = [...new Set(valid.map((pair) => pair.beforeDriveFileId))];
            const verified = new Map<string, BeforePhoto>();
            // Bound Drive metadata concurrency; B&W variants share one lookup.
            for (let offset = 0; offset < beforeIds.length; offset += 4) {
                await Promise.all(beforeIds.slice(offset, offset + 4).map(async (fileId) => {
                    try {
                        const p = await getDrivePhotoMetadata(fileId);
                        if (!p.mimeType.startsWith("image/")) return;
                        verified.set(fileId, { driveFileId: p.id, filename: p.name, mimeType: p.mimeType, thumbnailUrl: p.thumbnailLink || null, width: p.width ?? null, height: p.height ?? null });
                    } catch { /* An unavailable before photo must not block delivery. */ }
                }));
            }
            for (const pair of valid) {
                const before = verified.get(pair.beforeDriveFileId);
                if (before) beforeByEdited.set(pair.editedDriveFileId, before);
            }
            const removed = draft.comparisonPairs.length - beforeByEdited.size;
            if (removed) warnings.push(`${removed} unavailable comparison pair(s) were omitted. Review Manage Pairs.`);
        }
        const keyHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
        const publishedAt = new Date().toISOString();
        const expiresAt = editResultsExpiryFromDuration(gallery.editResultsAccessDurationHours, publishedAt);
        const statements = [
            { sql: "DELETE FROM gallery_edit_result_photos WHERE gallery_id = ?", params: [id] },
            { sql: "DELETE FROM gallery_edit_result_folders WHERE gallery_id = ?", params: [id] },
            ...folders.map((folder) => ({
                sql: "INSERT INTO gallery_edit_result_folders (gallery_id, drive_folder_id, parent_id, name) VALUES (?, ?, ?, ?)",
                params: [id, folder.id, folder.parentId, folder.name],
            })),
            ...snapshot.map(({ photo, downloadUrl, displayOrder }) => ({
                sql: "INSERT INTO gallery_edit_result_photos (gallery_id, drive_file_id, filename, mime_type, thumbnail_url, web_content_link, resource_key, width, height, display_order, before_photo, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params: [id, photo.id, photo.name, photo.mimeType, photo.thumbnailLink || null, downloadUrl, photo.resourceKey || null, photo.width ?? null, photo.height ?? null, displayOrder, beforeByEdited.has(photo.id) ? JSON.stringify(beforeByEdited.get(photo.id)) : null, photo.folderId],
            })),
            { sql: "UPDATE galleries SET edit_results_status = 'open', edit_results_key_hash = ?, edit_results_published_at = ?, edit_results_expires_at = ?, edit_results_photo_count = ?, edit_results_zip_filename = ?, edit_results_zip_download_url = ?, edit_results_version = edit_results_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [keyHash, publishedAt, expiresAt, snapshot.length, archive?.filename || null, archive?.downloadUrl || null, id] },
        ];
        await galleryBatch(statements);
        return c.json({ publishedAt, expiresAt, expiresIn: editResultsExpiresIn(expiresAt), photoCount: snapshot.length, folderCount: folders.length, comparisonCount: beforeByEdited.size, warnings }, 201, { "Cache-Control": "no-store" });
    } catch (error) {
        console.error(`[gallery ${id}] Edited photos publish failed:`, error instanceof Error ? error.message : error);
        return c.json({ error: "Unable to verify or publish this Google Drive folder." }, 502);
    }
});

adminGalleriesRouter.post("/:id/edit-results/unpublish", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<{ id: number }>("SELECT id FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    await galleryBatch([
        { sql: "DELETE FROM gallery_edit_result_photos WHERE gallery_id = ?", params: [id] },
        { sql: "DELETE FROM gallery_edit_result_folders WHERE gallery_id = ?", params: [id] },
        { sql: "UPDATE galleries SET edit_results_status = 'draft', edit_results_key_hash = NULL, edit_results_published_at = NULL, edit_results_expires_at = NULL, edit_results_photo_count = 0, edit_results_zip_filename = NULL, edit_results_zip_download_url = NULL, edit_results_version = edit_results_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [id] },
    ]);
    return c.json({ status: "unpublished" });
});

adminGalleriesRouter.delete("/:id", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<{ id: number }>("SELECT id FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);

    // Delete dependent metadata explicitly so cleanup is reliable across SQLite/Turso settings.
    await galleryRun("DELETE FROM face_index_photos WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM face_embeddings WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM face_index_jobs WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM gallery_edit_requests WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM gallery_edit_result_photos WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM gallery_edit_result_folders WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM gallery_photos WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM gallery_selections WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM galleries WHERE id = ?", [id]);
    return c.json({ status: "deleted" });
});

adminGalleriesRouter.post("/:id/sync", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, drive_folder_id as "driveFolderId", pin_hash as "pinHash", status,
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);

    const photos = await listDrivePhotos(gallery.driveFolderId);
    const existingPhotos = await galleryAll<PhotoRow & { sourceVersion: string }>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt", source_version as "sourceVersion"
        FROM gallery_photos WHERE gallery_id = ?
    `, [id]);
    const normalizedExistingPhotos = existingPhotos.map((photo) => photoShape(photo as PhotoRow & Record<string, unknown>));
    const existingByDriveId = new Map(normalizedExistingPhotos.map((photo) => [photo.driveFileId, photo]));
    const existingVersions = new Map(existingPhotos.map((photo) => [photo.driveFileId, photo.sourceVersion]));
    const driveIds = new Set(photos.map((photo) => photo.id));
    const syncStatements: Array<{ sql: string; params: unknown[] }> = [];
    let photoChanges = 0;

    for (const existingPhoto of normalizedExistingPhotos) {
        if (!driveIds.has(existingPhoto.driveFileId)) {
            syncStatements.push({ sql: "DELETE FROM gallery_photos WHERE gallery_id = ? AND drive_file_id = ?", params: [id, existingPhoto.driveFileId] });
            syncStatements.push({ sql: "DELETE FROM gallery_selections WHERE gallery_id = ? AND selected_drive_file_id = ?", params: [id, existingPhoto.driveFileId] });
            photoChanges += 1;
        }
    }

    for (const [index, photo] of photos.entries()) {
        const existingPhoto = existingByDriveId.get(photo.id);
        const nextThumbnail = photo.thumbnailLink || null;
        const nextWebView = photo.webViewLink || null;
        const nextWidth = photo.width || null;
        const nextHeight = photo.height || null;
        // Binary images have a checksum; timestamps/size cover formats without one.
        const nextSourceVersion = photo.md5Checksum
            ? `md5:${photo.md5Checksum}`
            : `${photo.modifiedTime || new Date().toISOString()}:${photo.size || ""}`;
        if (!existingPhoto) {
            syncStatements.push({ sql: `
                INSERT INTO gallery_photos (
                    gallery_id, drive_file_id, filename, mime_type, thumbnail_url,
                    web_view_url, width, height, display_order, source_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, params: [
                id,
                photo.id,
                photo.name,
                photo.mimeType,
                nextThumbnail,
                nextWebView,
                nextWidth,
                nextHeight,
                index,
                nextSourceVersion,
            ] });
            photoChanges += 1;
            continue;
        }

        if (
            existingPhoto.filename !== photo.name
            || existingPhoto.mimeType !== photo.mimeType
            || (existingPhoto.thumbnailUrl || null) !== nextThumbnail
            || (existingPhoto.webViewUrl || null) !== nextWebView
            || (existingPhoto.width || null) !== nextWidth
            || (existingPhoto.height || null) !== nextHeight
            || Number(existingPhoto.displayOrder) !== index
            || existingVersions.get(photo.id) !== nextSourceVersion
        ) {
            syncStatements.push({ sql: `
                UPDATE gallery_photos
                SET filename = ?, mime_type = ?, thumbnail_url = ?, web_view_url = ?, width = ?, height = ?, display_order = ?, source_version = ?
                WHERE gallery_id = ? AND drive_file_id = ?
            `, params: [
                photo.name,
                photo.mimeType,
                nextThumbnail,
                nextWebView,
                nextWidth,
                nextHeight,
                index,
                nextSourceVersion,
                id,
                photo.id,
            ] });
            photoChanges += 1;
        }
    }
    syncStatements.push({
        sql: `
            UPDATE galleries
            SET photo_count = ?,
                selection_count = (SELECT COUNT(*) FROM gallery_selections WHERE gallery_id = ?),
                synced_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
        params: [photos.length, id, id],
    });
    await galleryBatch(syncStatements);
    await getFaceSourceVersion(id);
    void prepareGalleryFaceIndex(id);
    return c.json({ status: "synced", photoCount: photos.length, changes: photoChanges });
});

adminGalleriesRouter.get("/:id/export.csv", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.text("Invalid gallery ID", 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, title, drive_folder_id as \"driveFolderId\", pin_hash as \"pinHash\", status, created_at as \"createdAt\", updated_at as \"updatedAt\", synced_at as \"syncedAt\", access_version as \"accessVersion\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.text("Gallery not found", 404);
    const selections = await galleryAll<SelectionRow>(`
        SELECT s.id, s.gallery_id as "galleryId", s.selected_drive_file_id as "selectedDriveFileId",
               s.selected_filename as "selectedFilename", p.display_order as "displayOrder",
               s.note, s.submitted_at as "submittedAt"
        FROM gallery_selections s
        LEFT JOIN gallery_photos p ON p.gallery_id = s.gallery_id AND p.drive_file_id = s.selected_drive_file_id
        WHERE s.gallery_id = ?
        ORDER BY COALESCE(p.display_order, 2147483647), s.selected_filename
    `, [id]);
    const lines = [
        ["gallery_id", "gallery_title", "client_label", "drive_file_id", "filename", "note", "submitted_at"].map(csvEscape).join(","),
        ...selections.map((row, index) => [
            gallery.id,
            gallery.title,
            galleryPhotoDisplayLabel(gallery.title, selectionDisplayIndex(row, index)),
            row.selectedDriveFileId,
            row.selectedFilename,
            row.note,
            row.submittedAt,
        ].map(csvEscape).join(",")),
    ];
    return new Response(lines.join("\n"), {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="gallery-${id}-selections.csv"`,
        },
    });
});

adminGalleriesRouter.get("/:id/export.xlsx", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, title, drive_folder_id as \"driveFolderId\", pin_hash as \"pinHash\", status, created_at as \"createdAt\", updated_at as \"updatedAt\", synced_at as \"syncedAt\", access_version as \"accessVersion\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    const selections = await galleryAll<SelectionRow>(`
        SELECT s.id, s.gallery_id as "galleryId", s.selected_drive_file_id as "selectedDriveFileId",
               s.selected_filename as "selectedFilename", p.display_order as "displayOrder",
               s.note, s.submitted_at as "submittedAt"
        FROM gallery_selections s
        LEFT JOIN gallery_photos p ON p.gallery_id = s.gallery_id AND p.drive_file_id = s.selected_drive_file_id
        WHERE s.gallery_id = ?
        ORDER BY COALESCE(p.display_order, 2147483647), s.selected_filename
    `, [id]);
    const rows = [
        ["No", "Gallery", "ClientLabel", "DriveFileId", "Filename", "Note", "SubmittedAt"],
        ...selections.map((row, index) => [
            index + 1,
            gallery.title,
            galleryPhotoDisplayLabel(gallery.title, selectionDisplayIndex(row, index)),
            row.selectedDriveFileId,
            row.selectedFilename,
            row.note || "",
            row.submittedAt,
        ]),
    ];
    const file = await writeExcelFile(rows, { sheet: "Selections" }).toBuffer();
    return new Response(file, {
        headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="gallery-${id}-selections.xlsx"`,
        },
    });
});

adminGalleriesRouter.get("/:id/export-copy.ps1", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.text("Invalid gallery ID", 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, title, drive_folder_id as \"driveFolderId\", pin_hash as \"pinHash\", status, created_at as \"createdAt\", updated_at as \"updatedAt\", synced_at as \"syncedAt\", access_version as \"accessVersion\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.text("Gallery not found", 404);
    const selections = await galleryAll<SelectionRow>(`
        SELECT s.id, s.gallery_id as "galleryId", s.selected_drive_file_id as "selectedDriveFileId",
               s.selected_filename as "selectedFilename", p.display_order as "displayOrder",
               s.note, s.submitted_at as "submittedAt"
        FROM gallery_selections s
        LEFT JOIN gallery_photos p ON p.gallery_id = s.gallery_id AND p.drive_file_id = s.selected_drive_file_id
        WHERE s.gallery_id = ?
        ORDER BY COALESCE(p.display_order, 2147483647), s.selected_filename
    `, [id]);
    const entries = selections.map((row, index) => {
        const clientLabel = galleryPhotoDisplayLabel(gallery.title, selectionDisplayIndex(row, index));
        return `    [pscustomobject]@{ ClientLabel = ${powershellSingleQuoted(clientLabel)}; Filename = ${powershellSingleQuoted(row.selectedFilename)}; DriveFileId = ${powershellSingleQuoted(row.selectedDriveFileId)} }`;
    });
    const script = [
        "# Orbit submitted selection copy script",
        `# Gallery: ${gallery.title}`,
        `# Gallery ID: ${gallery.id}`,
        "#",
        "# Usage:",
        "# 1. Run this script in PowerShell on Windows.",
        "# 2. Choose the folder containing the original Google Drive photos.",
        "# 3. Choose where the selected photos should be copied.",
        "",
        "$ErrorActionPreference = 'Stop'",
        "Add-Type -AssemblyName System.Windows.Forms",
        "",
        "function Select-Folder([string]$Description, [bool]$AllowCreate) {",
        "    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        "    $dialog.Description = $Description",
        "    $dialog.ShowNewFolderButton = $AllowCreate",
        "    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }",
        "    return $null",
        "}",
        "",
        "$SourceRoot = Select-Folder 'Where are the original Google Drive photos?' $false",
        "if (-not $SourceRoot) { exit }",
        "$DestinationRoot = Select-Folder 'Where should the selected photos be copied?' $true",
        "if (-not $DestinationRoot) { exit }",
        "",
        "$Selections = @(",
        entries.length ? entries.join("\n") : "    # No submitted selections yet.",
        ")",
        "",
        "New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null",
        "$filesByStem = @{}",
        "Get-ChildItem -LiteralPath $SourceRoot -File -Recurse | ForEach-Object {",
        "    $stem = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)",
        "    if (-not $filesByStem.ContainsKey($stem)) { $filesByStem[$stem] = @() }",
        "    $filesByStem[$stem] += $_",
        "}",
        "",
        "$matchedSelections = 0",
        "$copiedFiles = 0",
        "$missing = New-Object System.Collections.Generic.List[string]",
        "",
        "foreach ($item in $Selections) {",
        "    $stem = [System.IO.Path]::GetFileNameWithoutExtension($item.Filename)",
        "    if (-not $filesByStem.ContainsKey($stem)) {",
        "        $missing.Add($item.Filename)",
        "        continue",
        "    }",
        "",
        "    $matchedSelections += 1",
        "    foreach ($source in @($filesByStem[$stem])) {",
        "        $destination = Join-Path $DestinationRoot $source.Name",
        "        Copy-Item -LiteralPath $source.FullName -Destination $destination -Force",
        "        $copiedFiles += 1",
        "    }",
        "}",
        "",
        "$message = \"Matched $matchedSelections of $($Selections.Count) selection(s) and copied $copiedFiles file(s) to:`r`n$DestinationRoot\"",
        "if ($missing.Count) {",
        "    $message += \"`r`n`r`nMissing $($missing.Count) file(s):`r`n\" + (($missing | Select-Object -First 10) -join \"`r`n\")",
        "    if ($missing.Count -gt 10) { $message += \"`r`n...and $($missing.Count - 10) more.\" }",
        "}",
        "[System.Windows.Forms.MessageBox]::Show($message, 'The Orbit Photo', 'OK', 'Information') | Out-Null",
        "",
    ].join("\r\n");

    return new Response(script, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="${scriptSafeFilenamePart(gallery.title)}-${id}-copy-submitted.ps1"`,
            "X-Content-Type-Options": "nosniff",
        },
    });
});

publicGalleriesRouter.get("/:id/contact", async (c) => {
    const settings = await getGallerySettings();
    return c.json({ contactWhatsappUrl: settings.contact_whatsapp_url || null, message: settings.contact_whatsapp_message || DEFAULT_CONTACT_MESSAGE, requestMoreMessage: settings.request_more_whatsapp_message || DEFAULT_REQUEST_MORE_MESSAGE });
});

async function serveTutorialImage(c: Context<Env>, slot: number, variant: string): Promise<Response> {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;

    if (!Number.isInteger(slot) || slot < 1 || slot > 3 || (variant !== "before" && variant !== "after")) {
        return c.json({ error: "Tutorial image not found." }, 404);
    }

    const sample = tutorialSampleFileIds(result.gallery, slot);
    const fileId = variant === "before" ? sample.before : sample.after;
    if (!fileId) return c.json({ error: "Tutorial image is not configured." }, 404);

    try {
        const metadata = await getDrivePhotoMetadata(fileId);
        let driveResponse: Response;
        if (metadata.thumbnailLink) {
            try {
                driveResponse = await fetchDriveFile(fileId, metadata.thumbnailLink, 1280, true);
            } catch {
                driveResponse = await fetchDriveFile(fileId);
            }
        } else {
            driveResponse = await fetchDriveFile(fileId);
        }
        return new Response(driveResponse.body, {
            headers: {
                "Content-Type": driveResponse.headers.get("Content-Type") || "image/jpeg",
                "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        console.warn(`[culling tutorial] Unable to load ${variant} image for gallery ${result.gallery.id}:`, error instanceof Error ? error.message : error);
        return c.json({ error: "Unable to load tutorial image." }, 502);
    }
}

publicGalleriesRouter.get("/:id/tutorial/:slot/:variant", async (c) => {
    return serveTutorialImage(c, Number(c.req.param("slot")), c.req.param("variant"));
});

// Keep the original slot-one URL working for already-open client sessions and saved links.
publicGalleriesRouter.get("/:id/tutorial/:variant", async (c) => {
    return serveTutorialImage(c, 1, c.req.param("variant"));
});

publicGalleriesRouter.get("/:id/edit-results/status", async (c) => {
    const lookup = galleryLookup(c.req.param("id") || "");
    const gallery = await galleryOne<{ editResultsStatus: GalleryStatus; editResultsPhotoCount?: number; editResultsExpiresAt?: string | null }>(
        `SELECT edit_results_expires_at as "editResultsExpiresAt", edit_results_status as "editResultsStatus", edit_results_photo_count as "editResultsPhotoCount" FROM galleries WHERE ${lookup.sql}`,
        lookup.params,
    );
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    c.header("Cache-Control", "no-store");
    return c.json({ available: gallery.editResultsStatus === "open" && !editResultsExpired(gallery.editResultsExpiresAt) && Number(gallery.editResultsPhotoCount || 0) > 0, photoCount: Number(gallery.editResultsPhotoCount || 0), status: gallery.editResultsStatus === "open" && editResultsExpired(gallery.editResultsExpiresAt) ? "closed" : gallery.editResultsStatus, isExpired: editResultsExpired(gallery.editResultsExpiresAt) });
});

publicGalleriesRouter.post("/:id/edit-results/verify", async (c) => {
    const lookup = galleryLookup(c.req.param("id") || "");
    const gallery = await galleryOne<{ id: number; editResultsStatus: GalleryStatus; editResultsKeyHash?: string | null; editResultsVersion?: number; editResultsPhotoCount?: number; editResultsExpiresAt?: string | null }>(
        `SELECT id, edit_results_key_hash as "editResultsKeyHash", edit_results_version as "editResultsVersion", edit_results_status as "editResultsStatus", edit_results_photo_count as "editResultsPhotoCount", edit_results_expires_at as "editResultsExpiresAt" FROM galleries WHERE ${lookup.sql}`,
        lookup.params,
    );
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    if (!gallery.editResultsKeyHash || !Number(gallery.editResultsPhotoCount || 0)) return c.json({ error: "Edited photos are not available yet." }, 404);
    if (editResultsExpired(gallery.editResultsExpiresAt)) return c.json({ error: "Edited photos access has expired. Please contact the photographer.", code: "EDIT_RESULTS_EXPIRED" }, 403);
    if (gallery.editResultsStatus !== "open") return c.json({ error: "Edited photos access is closed. Please contact the photographer.", code: "EDIT_RESULTS_CLOSED" }, 403);
    const body = await c.req.json().catch(() => ({}));
    const password = String(body.password ?? body.key ?? "").trim();
    if (!password || !await Bun.password.verify(password, gallery.editResultsKeyHash)) return c.json({ error: "Invalid edited photos password." }, 401);
    const token = await createEditResultsToken(gallery.id, Number(gallery.editResultsVersion || 0), gallery.editResultsExpiresAt || null);
    c.header("Cache-Control", "no-store");
    return c.json({ token, expiresAt: gallery.editResultsExpiresAt || null, expiresIn: editResultsExpiresIn(gallery.editResultsExpiresAt) });
});

async function requireEditResultsAccess(c: Context<Env>): Promise<{ galleryId: number; token: string; expiresAt: string | null } | Response> {
    const lookup = galleryLookup(c.req.param("id") || "");
    const gallery = await galleryOne<{ id: number; editResultsStatus: GalleryStatus; editResultsVersion?: number; editResultsPhotoCount?: number; editResultsKeyHash?: string | null; editResultsExpiresAt?: string | null }>(
        `SELECT id, edit_results_version as "editResultsVersion", edit_results_status as "editResultsStatus", edit_results_photo_count as "editResultsPhotoCount", edit_results_key_hash as "editResultsKeyHash", edit_results_expires_at as "editResultsExpiresAt" FROM galleries WHERE ${lookup.sql}`,
        lookup.params,
    );
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    if (!gallery.editResultsKeyHash || !Number(gallery.editResultsPhotoCount || 0)) return c.json({ error: "Edited photos are not available." }, 404);
    if (editResultsExpired(gallery.editResultsExpiresAt)) return c.json({ error: "Edited photos access has expired. Please contact the photographer.", code: "EDIT_RESULTS_EXPIRED" }, 403);
    if (gallery.editResultsStatus !== "open") return c.json({ error: "Edited photos access is closed. Please contact the photographer.", code: "EDIT_RESULTS_CLOSED" }, 403);
    const token = c.req.query("token") || c.req.header("x-edit-results-token") || "";
    if (!token || !await verifyEditResultsToken(token, gallery.id, Number(gallery.editResultsVersion || 0), gallery.editResultsExpiresAt || null)) {
        return c.json({ error: "Download access expired. Enter the edited photos password again." }, 401);
    }
    return { galleryId: gallery.id, token, expiresAt: gallery.editResultsExpiresAt || null };
}

publicGalleriesRouter.get("/:id/edit-results", async (c) => {
    const access = await requireEditResultsAccess(c);
    if (access instanceof Response) return access;
    const gallery = await galleryOne<{ editResultsPublishedAt?: string | null; editResultsExpiresAt?: string | null; archiveFilename?: string | null; archiveDownloadUrl?: string | null }>("SELECT edit_results_published_at as \"editResultsPublishedAt\", edit_results_expires_at as \"editResultsExpiresAt\", edit_results_zip_filename as \"archiveFilename\", edit_results_zip_download_url as \"archiveDownloadUrl\" FROM galleries WHERE id = ?", [access.galleryId]);
    const photos = await galleryAll<Record<string, unknown>>(`
        SELECT drive_file_id as "driveFileId", filename, mime_type as "mimeType", width, height, display_order as "displayOrder", web_content_link as "downloadUrl", before_photo as "beforePhoto", folder_id as "folderId"
        FROM gallery_edit_result_photos WHERE gallery_id = ? ORDER BY display_order, filename
    `, [access.galleryId]);
    const folders = await galleryAll<DriveFolder>('SELECT drive_folder_id as id, parent_id as "parentId", name FROM gallery_edit_result_folders WHERE gallery_id = ? ORDER BY name, drive_folder_id', [access.galleryId]);
    c.header("Cache-Control", "no-store");
    return c.json({
        publishedAt: gallery?.editResultsPublishedAt || null,
        folders: folders.map((folder) => ({ id: folder.id, parentId: folder.parentId, name: folder.name })),
        expiresAt: gallery?.editResultsExpiresAt || null,
        expiresIn: editResultsExpiresIn(gallery?.editResultsExpiresAt),
        archive: gallery?.archiveFilename && gallery.archiveDownloadUrl
            ? { filename: gallery.archiveFilename, downloadUrl: gallery.archiveDownloadUrl }
            : null,
        photos: photos.map((photo) => {
            const path = `/api/public/galleries/${encodeURIComponent(c.req.param("id"))}/edit-results/photos/${encodeURIComponent(String(photo.driveFileId))}`;
            const query = `?token=${encodeURIComponent(access.token)}`;
            return {
                driveFileId: photo.driveFileId, filename: photo.filename, mimeType: photo.mimeType,
                width: photo.width, height: photo.height, displayOrder: photo.displayOrder,
                downloadUrl: photo.downloadUrl, folderId: photo.folderId ?? null,
                thumbnailUrl: `${path}/thumbnail${query}`, previewUrl: `${path}/preview${query}`,
                comparison: readBeforePhoto(photo.beforePhoto) ? { thumbnailUrl: `${path}/before/thumbnail${query}`, previewUrl: `${path}/before/preview${query}` } : null,
            };
        }),
    });
});

async function serveEditResultImage(c: Context<Env>, width: 320 | 1600): Promise<Response> {
    const access = await requireEditResultsAccess(c);
    if (access instanceof Response) return access;
    const fileId = c.req.param("fileId") || "";
    const photo = await galleryOne<{ driveFileId: string; mimeType: string; thumbnailUrl?: string | null }>(`
        SELECT drive_file_id as "driveFileId", mime_type as "mimeType", thumbnail_url as "thumbnailUrl"
        FROM gallery_edit_result_photos WHERE gallery_id = ? AND drive_file_id = ?
    `, [access.galleryId, fileId]);
    if (!photo) return c.json({ error: "Edited photo not found." }, 404);
    try {
        let driveResponse: Response;
        try {
            if (!photo.thumbnailUrl) throw new Error("Edited photo thumbnail is missing.");
            driveResponse = await fetchDriveFile(fileId, photo.thumbnailUrl, width, width === 1600);
        } catch {
            const refreshed = await getDrivePhotoMetadata(fileId);
            if (!refreshed.thumbnailLink) throw new Error("Google Drive did not return an edited photo thumbnail.");
            driveResponse = await fetchDriveFile(fileId, refreshed.thumbnailLink, width, width === 1600);
            await galleryRun("UPDATE gallery_edit_result_photos SET thumbnail_url = ? WHERE gallery_id = ? AND drive_file_id = ?", [refreshed.thumbnailLink || null, access.galleryId, fileId]);
        }
        return new Response(driveResponse.body, {
            headers: {
                "Content-Type": driveResponse.headers.get("Content-Type") || photo.mimeType || "image/jpeg",
                "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
            },
        });
    } catch (error) {
        console.warn(`[edited photos] Preview failed for gallery ${access.galleryId}:`, error instanceof Error ? error.message : error);
        return c.json({ error: "Unable to load edited photo preview." }, 502);
    }
}

publicGalleriesRouter.get("/:id/edit-results/photos/:fileId/thumbnail", (c) => serveEditResultImage(c, 320));
publicGalleriesRouter.get("/:id/edit-results/photos/:fileId/preview", (c) => serveEditResultImage(c, 1600));

publicGalleriesRouter.get("/:id/edit-results/photos/:fileId/before/:variant", async (c) => {
    const access = await requireEditResultsAccess(c);
    if (access instanceof Response) return access;
    const variant = c.req.param("variant");
    if (variant !== "thumbnail" && variant !== "preview") return c.notFound();
    const row = await galleryOne<{ beforePhoto: string | null }>('SELECT before_photo as "beforePhoto" FROM gallery_edit_result_photos WHERE gallery_id = ? AND drive_file_id = ?', [access.galleryId, c.req.param("fileId")]);
    const photo = readBeforePhoto(row?.beforePhoto);
    if (!photo) return c.json({ error: "Comparison is not available." }, 404);
    try {
        const response = await comparisonImage(photo, variant === "thumbnail" ? 320 : 1600);
        return new Response(response.body, { headers: { "Content-Type": response.headers.get("Content-Type") || photo.mimeType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
    } catch { return c.json({ error: "Unable to load comparison photo." }, 502); }
});

publicGalleriesRouter.post("/:id/verify", async (c) => {
    const identifier = c.req.param("id");
    if (!identifier) return c.json({ error: "Gallery ID is required." }, 400);
    const lookup = galleryLookup(identifier);
    const body = await c.req.json().catch(() => ({}));
    const pin = String(body.pin || "").trim();
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, drive_folder_id as "driveFolderId", pin_hash as "pinHash", status,
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt", access_version as "accessVersion", contact_whatsapp_url as "contactWhatsappUrl", max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice", qris_enabled as "qrisEnabled", edit_results_status as "editResultsStatus", edit_results_photo_count as "editResultsPhotoCount", tutorial_before_drive_file_id as "tutorialBeforeDriveFileId", tutorial_after_drive_file_id as "tutorialAfterDriveFileId", tutorial_before_2_drive_file_id as "tutorialBefore2DriveFileId", tutorial_after_2_drive_file_id as "tutorialAfter2DriveFileId", tutorial_before_3_drive_file_id as "tutorialBefore3DriveFileId", tutorial_after_3_drive_file_id as "tutorialAfter3DriveFileId",
               photo_count as "photoCount", selection_count as "selectionCount", selection_duration_days as "selectionDurationDays", selection_duration_hours as "selectionDurationHours", selection_deadline_at as "selectionDeadlineAt"
        FROM galleries WHERE ${lookup.sql}
    `, lookup.params);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    const galleryExpired = isSelectionDeadlineExpired(gallery.selectionDeadlineAt);
    if (galleryExpired || gallery.status !== "open") {
        const settings = await getGallerySettings();
        const template = settings.contact_whatsapp_message || DEFAULT_CONTACT_MESSAGE;
        const text = galleryContactMessage(template, gallery, c.req.url);
        return c.json({
            error: galleryExpired ? "The selection deadline has ended." : "Gallery is locked. Please contact the admin to unlock it.",
            code: galleryExpired ? "GALLERY_EXPIRED" : "GALLERY_CLOSED",
            contactUrl: settings.contact_whatsapp_url ? `https://wa.me/${settings.contact_whatsapp_url}?text=${encodeURIComponent(text)}` : null,
        }, 403);
    }
    if (!pin || !await Bun.password.verify(pin, gallery.pinHash)) return c.json({ error: "Invalid PIN." }, 401);
    const token = await createGalleryToken(gallery.id, gallery.accessVersion);
    return c.json({ token, expiresIn: GALLERY_TOKEN_TTL_SECONDS, gallery: galleryPublicShape(gallery) });
});

publicGalleriesRouter.get("/:id/photo-manifest", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const sessionExpiresAt = galleryTokenExpiration(result.token) ?? Math.floor(Date.now() / 1000) + PHOTO_TOKEN_TTL_SECONDS;
    const deadlineExpiresAt = selectionDeadlineEpochSeconds(result.gallery.selectionDeadlineAt);
    const photoTokenExpiresAt = deadlineExpiresAt === null ? sessionExpiresAt : Math.min(sessionExpiresAt, deadlineExpiresAt);
    const photos = await galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height, display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? ORDER BY display_order, filename
    `, [result.gallery.id]);

    return c.json({
        gallery: galleryPublicShape(result.gallery),
        photos: photos.map((photo) => publicPhotoShape(photo as PhotoRow & Record<string, unknown>, result.gallery.accessVersion, photoTokenExpiresAt)),
        total: photos.length,
    });
});

publicGalleriesRouter.post("/:id/face-search", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const sessionExpiresAt = galleryTokenExpiration(result.token) ?? Math.floor(Date.now() / 1000) + PHOTO_TOKEN_TTL_SECONDS;
    const deadlineExpiresAt = selectionDeadlineEpochSeconds(result.gallery.selectionDeadlineAt);
    const photoTokenExpiresAt = deadlineExpiresAt === null ? sessionExpiresAt : Math.min(sessionExpiresAt, deadlineExpiresAt);
    return handlePublicFaceSearch(
        c,
        result.gallery.id,
        (photo) => publicPhotoShape(photo as PhotoRow & Record<string, unknown>, result.gallery.accessVersion, photoTokenExpiresAt),
        async () => {
            const fresh = await requirePublicGallery(c);
            if (fresh instanceof Response) return fresh;
            return fresh.gallery.id === result.gallery.id ? null : c.json({ error: "Gallery access changed." }, 401);
        },
    );
});

publicGalleriesRouter.get("/:id/face-search/status", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    return handlePublicFaceSearchStatus(c, result.gallery.id);
});

publicGalleriesRouter.get("/:id/photos", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const sessionExpiresAt = galleryTokenExpiration(result.token) ?? Math.floor(Date.now() / 1000) + PHOTO_TOKEN_TTL_SECONDS;
    const deadlineExpiresAt = selectionDeadlineEpochSeconds(result.gallery.selectionDeadlineAt);
    const photoTokenExpiresAt = deadlineExpiresAt === null ? sessionExpiresAt : Math.min(sessionExpiresAt, deadlineExpiresAt);
    const includeSelectedPhotos = c.req.query("includeSelectedPhotos") === "1";
    const includeSelections = c.req.query("includeSelections") === "1";
    const total = Number(result.gallery.photoCount || 0);
    const pageSize = Math.min(54, Math.max(1, Number(c.req.query("pageSize") || 54) || 54));
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const page = totalPages > 0 ? Math.min(totalPages, Math.max(1, Number(c.req.query("page") || 1) || 1)) : 1;
    const offset = (page - 1) * pageSize;
    const photosPromise = includeSelectedPhotos ? Promise.resolve<PhotoRow[]>([]) : galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height, display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? ORDER BY display_order, filename LIMIT ? OFFSET ?
    `, [result.gallery.id, pageSize, offset]);
    const selectionsPromise = includeSelections ? galleryAll<{ selectedDriveFileId: string }>(`
        SELECT selected_drive_file_id as "selectedDriveFileId" FROM gallery_selections WHERE gallery_id = ?
    `, [result.gallery.id]) : Promise.resolve<Array<{ selectedDriveFileId: string }>>([]);
    const selectedPhotosPromise = includeSelectedPhotos ? galleryAll<PhotoRow & { note?: string | null }>(`
        SELECT p.id, p.gallery_id as "galleryId", p.drive_file_id as "driveFileId", p.filename,
               p.mime_type as "mimeType", p.thumbnail_url as "thumbnailUrl", p.web_view_url as "webViewUrl", p.width, p.height, p.display_order as "displayOrder",
               p.created_at as "createdAt", s.note
        FROM gallery_photos p
        INNER JOIN gallery_selections s ON s.gallery_id = p.gallery_id AND s.selected_drive_file_id = p.drive_file_id
        WHERE p.gallery_id = ? ORDER BY p.display_order, p.filename
    `, [result.gallery.id]) : Promise.resolve<Array<PhotoRow & { note?: string | null }>>([]);
    const [photos, selections, selectedPhotos] = await Promise.all([
        photosPromise,
        selectionsPromise,
        selectedPhotosPromise,
    ]);
    return c.json({
        gallery: galleryPublicShape(result.gallery),
        photos: photos.map((photo) => publicPhotoShape(photo as PhotoRow & Record<string, unknown>, result.gallery.accessVersion, photoTokenExpiresAt)),
        page,
        pageSize,
        total,
        totalPages,
        ...(includeSelections ? { selectedDriveFileIds: selections.map((row) => selectionDriveFileId(row as Record<string, unknown>)).filter(Boolean) } : {}),
        selectedPhotos: selectedPhotos.map((photo) => publicPhotoShape(photo as PhotoRow & Record<string, unknown>, result.gallery.accessVersion, photoTokenExpiresAt)),
    });
});

publicGalleriesRouter.get("/:id/photos/:fileId/thumbnail", async (c) => {
    const fileId = c.req.param("fileId");
    const tokenPhoto = photoFromImageToken(c, fileId);
    let photo = tokenPhoto;
    let galleryId = tokenPhoto?.galleryId ?? 0;
    if (!photo) {
        const result = await requirePublicGallery(c);
        if (result instanceof Response) return result;
        galleryId = result.gallery.id;
        photo = await photoForImageRequest(c, result.gallery, fileId);
    }
    if (!photo) return c.json({ error: "Photo not found" }, 404);
    let driveResponse: Response;
    try {
        driveResponse = await fetchDriveFile(photo.driveFileId, photo.thumbnailUrl || undefined, 320);
    } catch {
        const refreshed = await getDrivePhotoMetadata(photo.driveFileId);
        if (!refreshed.thumbnailLink) throw new Error("Google Drive did not return a thumbnail for this photo.");
        if (!tokenPhoto) await galleryRun("UPDATE gallery_photos SET thumbnail_url = ?, web_view_url = ? WHERE gallery_id = ? AND drive_file_id = ?", [refreshed.thumbnailLink, refreshed.webViewLink || null, galleryId, photo.driveFileId]);
        driveResponse = await fetchDriveFile(photo.driveFileId, refreshed.thumbnailLink, 320);
    }
    return new Response(driveResponse.body, {
        headers: {
            "Content-Type": driveResponse.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": GALLERY_IMAGE_CACHE_CONTROL,
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
});

publicGalleriesRouter.get("/:id/photos/:fileId/preview", async (c) => {
    const fileId = c.req.param("fileId");
    const tokenPhoto = photoFromImageToken(c, fileId);
    let photo = tokenPhoto;
    let galleryId = tokenPhoto?.galleryId ?? 0;
    if (!photo) {
        const result = await requirePublicGallery(c);
        if (result instanceof Response) return result;
        galleryId = result.gallery.id;
        photo = await photoForImageRequest(c, result.gallery, fileId);
    }
    if (!photo) return c.json({ error: "Photo not found" }, 404);

    let driveResponse: Response;
    try {
        driveResponse = await fetchDriveFile(photo.driveFileId, photo.thumbnailUrl || undefined, 1600, true);
    } catch {
        let refreshedThumbnail: string | undefined;
        try {
            const refreshed = await getDrivePhotoMetadata(photo.driveFileId);
            if (!tokenPhoto) await galleryRun("UPDATE gallery_photos SET thumbnail_url = ?, web_view_url = ? WHERE gallery_id = ? AND drive_file_id = ?", [refreshed.thumbnailLink || null, refreshed.webViewLink || null, galleryId, photo.driveFileId]);
            refreshedThumbnail = refreshed.thumbnailLink || undefined;
        } catch {
            refreshedThumbnail = undefined;
        }
        try {
            driveResponse = await fetchDriveFile(photo.driveFileId, refreshedThumbnail, 1600, true);
        } catch {
            driveResponse = await fetchDriveFile(photo.driveFileId);
        }
    }
    return new Response(driveResponse.body, {
        headers: {
            "Content-Type": driveResponse.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": GALLERY_IMAGE_CACHE_CONTROL,
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
});

publicGalleriesRouter.get("/:id/photos/:fileId/content", async (c) => {
    const fileId = c.req.param("fileId");
    let photo = photoFromImageToken(c, fileId);
    if (!photo) {
        const result = await requirePublicGallery(c);
        if (result instanceof Response) return result;
        photo = await photoForImageRequest(c, result.gallery, fileId);
    }
    if (!photo) return c.json({ error: "Photo not found" }, 404);
    const driveResponse = await fetchDriveFile(photo.driveFileId);
    return new Response(driveResponse.body, {
        headers: {
            "Content-Type": driveResponse.headers.get("Content-Type") || photo.mimeType || "application/octet-stream",
            "Cache-Control": "private, max-age=3600, stale-while-revalidate=300",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
});

publicGalleriesRouter.post("/:id/selections", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const body = await c.req.json().catch(() => ({})) as { selections?: unknown };
    const rawSelections = Array.isArray(body.selections) ? body.selections : [];
    const parsedSelections = rawSelections.flatMap((value: unknown) => {
        if (typeof value === "string" && value.length > 0) return [{ driveFileId: value, note: "" }];
        if (!value || typeof value !== "object") return [];
        const item = value as { driveFileId?: unknown; note?: unknown };
        if (typeof item.driveFileId !== "string" || !item.driveFileId) return [];
        const note = typeof item.note === "string" ? item.note.trim() : "";
        return note.length <= 500 ? [{ driveFileId: item.driveFileId, note }] : [];
    });
    const selections = Array.from(new Map(parsedSelections.map((item) => [item.driveFileId, item])).values());
    const paidAddonLimit = normalizeAddonStatus(result.gallery.editAddonStatus) === "paid" ? Number(result.gallery.additionalSelectionLimit || 0) : 0;
    const selectionLimit = (result.gallery.maxSelections || 0) + paidAddonLimit;
    if (selections.length > 500 || (selectionLimit && selections.length > selectionLimit) || selections.length !== rawSelections.length) return c.json({ error: `Choose no more than ${selectionLimit} photos.` }, 400);

    const photos = await galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ?
    `, [result.gallery.id]);
    const photoMap = new Map(photos.map((photo) => [photo.driveFileId, photo]));
    const selectedPhotos = selections.flatMap((selection) => {
        const photo = photoMap.get(selection.driveFileId);
        return photo ? [{ photo, note: selection.note }] : [];
    });

    await galleryBatch([
        { sql: "DELETE FROM gallery_selections WHERE gallery_id = ?", params: [result.gallery.id] },
        ...selectedPhotos.map(({ photo, note }) => ({
            sql: "INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename, note) VALUES (?, ?, ?, ?)",
            params: [result.gallery.id, photo.driveFileId, photo.filename, note || null],
        })),
        { sql: "UPDATE galleries SET selection_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [selectedPhotos.length, result.gallery.id] },
    ]);
    return c.json({
        status: "submitted",
        selectionCount: selectedPhotos.length,
        filenames: selectedPhotos.map(({ photo }) => photo.filename),
    });
});

export { adminGalleriesRouter, publicGalleriesRouter };
