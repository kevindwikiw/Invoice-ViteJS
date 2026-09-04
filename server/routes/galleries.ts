import { Hono, type Context } from "hono";
import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import writeExcelFile from "write-excel-file/node";
import { galleryAll, galleryBatch, galleryInsertReturningId, galleryOne, galleryRun } from "../db/galleries";
import { fetchDriveFile, getDrivePhotoMetadata, listDrivePhotos } from "../lib/google-drive";
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

type Env = {
    Variables: {
        user?: AuthUser;
        jwtPayload?: AuthUser;
    };
};

const adminGalleriesRouter = new Hono<Env>();
const publicGalleriesRouter = new Hono<Env>();

const GALLERY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const PHOTO_TOKEN_TTL_SECONDS = 60 * 60;
const GALLERY_IMAGE_CACHE_CONTROL = `private, max-age=${GALLERY_TOKEN_TTL_SECONDS}, immutable`;
const DEFAULT_ADDON_UNIT_PRICE = 10_000;
const DEFAULT_CONTACT_MESSAGE = "Halo Kak Admin Orbit\nSaya ingin meminta bantuan untuk membuka client gallery saya yaa.\n\nIni URL saya: {{gallery_url}}\nSaya client dari: {{gallery_title}}\n\nTerima kasih, Kak!";
const DEFAULT_REQUEST_MORE_MESSAGE = "Halo Kak Admin Orbit\nSaya ingin meminta tambahan edited photos.\n\nIni URL saya: {{gallery_url}}\nSaya client dari: {{gallery_title}}\nPilihan saat ini: {{selected_count}} foto\nSaya ingin menambah: {{requested_count}} foto\nPromo: {{promo_label}}\nEstimasi biaya: {{estimated_price}}";
const PUBLIC_KEY_TIME_ZONE = "Asia/Jakarta";

type AuthUser = { sub: number; email: string; name: string; role: string };
type GalleryStatus = "draft" | "open" | "closed";

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
    driveFolderId: string;
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
        addon: { enabled: addonActive, additionalLimit: addonActive ? Number(row.additionalSelectionLimit || 0) : 0, pricingMode: row.editAddonPricingMode || "per_photo", unitPrice: Number(row.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE), status: addonStatus },
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
    const isExpired = isSelectionDeadlineExpired(row.selectionDeadlineAt);
    const selectionDurationHours = selectionDurationHoursFromRow(row);
    return {
        id: row.id,
        title: row.title,
        driveFolderId: row.driveFolderId,
        publicKey: row.publicKey || String(row.id),
        status: isExpired ? "closed" : row.status,
        selectionDurationHours,
        selectionDurationDays: Math.ceil(selectionDurationHours / 24),
        selectionDeadlineAt: row.selectionDeadlineAt || null,
        isExpired,
        serverTime: new Date().toISOString(),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        syncedAt: row.syncedAt || null,
        photoCount: Number(counts?.photoCount ?? row.photoCount ?? 0),
        selectionCount: Number(counts?.selectionCount ?? row.selectionCount ?? 0),
        maxSelections: Number(row.maxSelections || 0),
        additionalLimit: Number(row.additionalSelectionLimit || 0),
        addonStatus,
        addon: { enabled: addonStatus === "paid", additionalLimit: Number(row.additionalSelectionLimit || 0), pricingMode: row.editAddonPricingMode || "per_photo", unitPrice: Number(row.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE) },
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
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", pin_hash as "pinHash", status,
               max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit",
               edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
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

    const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") || 10) || 10));
    const page = Math.max(1, Number(c.req.query("page") || 1) || 1);
    const status = normalizeStatus(c.req.query("status"), "draft");
    const hasStatusFilter = c.req.query("status") === "open" || c.req.query("status") === "closed" || c.req.query("status") === "draft";
    const search = String(c.req.query("search") || "").trim().slice(0, 100);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (hasStatusFilter) {
        const expired = "(g.selection_deadline_at IS NOT NULL AND datetime(g.selection_deadline_at) <= datetime('now'))";
        if (status === "closed") {
            conditions.push(`(g.status = 'closed' OR ${expired})`);
        } else {
            conditions.push(`(g.status = ? AND NOT ${expired})`);
            params.push(status);
        }
    }
    if (search) {
        conditions.push("(LOWER(g.title) LIKE LOWER(?) OR LOWER(g.drive_folder_id) LIKE LOWER(?))");
        const pattern = `%${search}%`;
        params.push(pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = await galleryOne<{ total: number }>(`SELECT COUNT(*) as total FROM galleries g ${where}`, params);
    const total = Number(totalRow?.total || 0);
    const rows = await galleryAll<GalleryRow & { photoCount?: number; selectionCount?: number }>(`
        SELECT g.id, g.title, g.drive_folder_id as "driveFolderId", g.pin_hash as "pinHash", g.status,
               g.public_key as "publicKey", g.contact_whatsapp_url as "contactWhatsappUrl",
               g.max_selections as "maxSelections", g.additional_selection_limit as "additionalSelectionLimit",
               g.edit_addon_status as "editAddonStatus", g.edit_addon_pricing_mode as "editAddonPricingMode", g.edit_addon_price as "editAddonPrice",
               g.photo_count as "photoCount", g.selection_count as "selectionCount",
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
    const addon = await galleryOne("SELECT additional_selection_limit as additionalLimit, edit_addon_status as status, edit_addon_pricing_mode as pricingMode, edit_addon_price as price, edit_addon_package_id as packageId FROM galleries WHERE id = ?", [id]);
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
    const status = normalizeStatus(body.status, "draft");
    const maxSelections = Math.min(500, Math.max(0, Number(body.maxSelections ?? 50) || 50));
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
        "INSERT INTO galleries (title, public_key, max_selections, edit_addon_pricing_mode, edit_addon_price, drive_folder_id, pin_hash, selection_duration_days, selection_duration_hours, selection_deadline_at, status) VALUES (?, ?, ?, 'per_photo', ?, ?, ?, ?, ?, ?, ?)",
        [title, publicKey, maxSelections, DEFAULT_ADDON_UNIT_PRICE, driveFolderId, pinHash, selectionDurationDays, selectionDurationHours, selectionDeadlineAt, status],
    );
    const row = await galleryOne<GalleryRow>(`
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
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
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
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
        SELECT id, gallery_id as "galleryId", selected_drive_file_id as "selectedDriveFileId",
               selected_filename as "selectedFilename", note, submitted_at as "submittedAt"
        FROM gallery_selections WHERE gallery_id = ? ORDER BY selected_filename
    `, [id]);
    return c.json({
        gallery: galleryAdminShape(gallery, { photoCount: photos.length, selectionCount: selections.length }),
        photos: photos.map((photo) => photoShape(photo as PhotoRow & Record<string, unknown>)),
        selections,
    });
});

adminGalleriesRouter.post("/:id/reset-pin-lock", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, public_key as \"publicKey\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    await resetGalleryPinAttempts([String(gallery.id), gallery.publicKey || ""]);
    return c.json({ status: "reset" });
});

adminGalleriesRouter.patch("/:id", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const existing = await galleryOne<GalleryRow>(`
        SELECT id, title, drive_folder_id as "driveFolderId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
               selection_count as "selectionCount", selection_duration_days as "selectionDurationDays", selection_duration_hours as "selectionDurationHours", selection_deadline_at as "selectionDeadlineAt", created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    if (!existing) return c.json({ error: "Gallery not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const title = body.title === undefined ? existing.title : String(body.title || "").trim();
    const driveFolderId = body.driveFolderId === undefined && body.driveFolderUrl === undefined
        ? existing.driveFolderId
        : normalizeDriveFolderId(body.driveFolderUrl ?? body.driveFolderId);
    const durationWasProvided = body.selectionDurationHours !== undefined || body.selectionDurationDays !== undefined;
    const requestedDurationHours = body.selectionDurationHours ?? (body.selectionDurationDays === undefined ? undefined : Number(body.selectionDurationDays) * 24);
    let deadlineUpdate;
    try {
        deadlineUpdate = resolveGalleryDeadlineUpdate({
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
    const pin = body.pin === undefined ? "" : String(body.pin || "").trim();
    const pinHash = pin ? await Bun.password.hash(pin, { algorithm: "bcrypt", cost: 10 }) : existing.pinHash;
    const activeSelectionLimit = maxSelections ? maxSelections + (editAddonStatus === "paid" ? additionalSelectionLimit : 0) : 0;
    const selectionCount = Number(existing.selectionCount || 0);

    if (!title || !driveFolderId) return c.json({ error: "Title and Drive folder ID are required." }, 400);
    if (body.pin !== undefined && pin.length > 0 && pin.length < 4) return c.json({ error: "PIN must be at least 4 characters." }, 400);
    if (activeSelectionLimit && selectionCount > activeSelectionLimit) {
        return c.json({ error: `Active limit cannot be lower than ${selectionCount} submitted selections.` }, 400);
    }

    await galleryRun(
        "UPDATE galleries SET title = ?, drive_folder_id = ?, pin_hash = ?, contact_whatsapp_url = ?, max_selections = ?, additional_selection_limit = ?, edit_addon_status = ?, edit_addon_pricing_mode = ?, edit_addon_price = ?, selection_duration_days = ?, selection_duration_hours = ?, selection_deadline_at = ?, status = ?, access_version = access_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [title, driveFolderId, pinHash, contactWhatsappUrl, maxSelections, additionalSelectionLimit, editAddonStatus, editAddonPricingMode, editAddonPrice, selectionDurationDays, selectionDurationHours, selectionDeadlineAt, status, id],
    );
    return c.json({ status: "updated" });
});

adminGalleriesRouter.delete("/:id", async (c) => {
    const denied = await requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<{ id: number }>("SELECT id FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);

    // Delete dependent metadata explicitly so cleanup is reliable across SQLite/Turso settings.
    await galleryRun("DELETE FROM gallery_edit_requests WHERE gallery_id = ?", [id]);
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
    const existingPhotos = await galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ?
    `, [id]);
    const normalizedExistingPhotos = existingPhotos.map((photo) => photoShape(photo as PhotoRow & Record<string, unknown>));
    const existingByDriveId = new Map(normalizedExistingPhotos.map((photo) => [photo.driveFileId, photo]));
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
        if (!existingPhoto) {
            syncStatements.push({ sql: `
                INSERT INTO gallery_photos (
                    gallery_id, drive_file_id, filename, mime_type, thumbnail_url,
                    web_view_url, width, height, display_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        ) {
            syncStatements.push({ sql: `
                UPDATE gallery_photos
                SET filename = ?, mime_type = ?, thumbnail_url = ?, web_view_url = ?, width = ?, height = ?, display_order = ?
                WHERE gallery_id = ? AND drive_file_id = ?
            `, params: [
                photo.name,
                photo.mimeType,
                nextThumbnail,
                nextWebView,
                nextWidth,
                nextHeight,
                index,
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
        SELECT id, gallery_id as "galleryId", selected_drive_file_id as "selectedDriveFileId",
               selected_filename as "selectedFilename", note, submitted_at as "submittedAt"
        FROM gallery_selections WHERE gallery_id = ? ORDER BY selected_filename
    `, [id]);
    const lines = [
        ["gallery_id", "gallery_title", "drive_file_id", "filename", "note", "submitted_at"].map(csvEscape).join(","),
        ...selections.map((row) => [gallery.id, gallery.title, row.selectedDriveFileId, row.selectedFilename, row.note, row.submittedAt].map(csvEscape).join(",")),
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
        SELECT id, gallery_id as "galleryId", selected_drive_file_id as "selectedDriveFileId",
               selected_filename as "selectedFilename", note, submitted_at as "submittedAt"
        FROM gallery_selections WHERE gallery_id = ? ORDER BY selected_filename
    `, [id]);
    const rows = [
        ["No", "Gallery", "DriveFileId", "Filename", "Note", "SubmittedAt"],
        ...selections.map((row, index) => [
            index + 1,
            gallery.title,
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

publicGalleriesRouter.get("/:id/contact", async (c) => {
    const settings = await getGallerySettings();
    return c.json({ contactWhatsappUrl: settings.contact_whatsapp_url || null, message: settings.contact_whatsapp_message || DEFAULT_CONTACT_MESSAGE, requestMoreMessage: settings.request_more_whatsapp_message || DEFAULT_REQUEST_MORE_MESSAGE });
});

publicGalleriesRouter.post("/:id/verify", async (c) => {
    const identifier = c.req.param("id");
    if (!identifier) return c.json({ error: "Gallery ID is required." }, 400);
    const lookup = galleryLookup(identifier);
    const body = await c.req.json().catch(() => ({}));
    const pin = String(body.pin || "").trim();
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, drive_folder_id as "driveFolderId", pin_hash as "pinHash", status,
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt", access_version as "accessVersion", contact_whatsapp_url as "contactWhatsappUrl", max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
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

publicGalleriesRouter.get("/:id/photos", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const sessionExpiresAt = galleryTokenExpiration(result.token) ?? Math.floor(Date.now() / 1000) + PHOTO_TOKEN_TTL_SECONDS;
    const deadlineExpiresAt = selectionDeadlineEpochSeconds(result.gallery.selectionDeadlineAt);
    const photoTokenExpiresAt = deadlineExpiresAt === null ? sessionExpiresAt : Math.min(sessionExpiresAt, deadlineExpiresAt);
    const includeSelectedPhotos = c.req.query("includeSelectedPhotos") === "1";
    const includeSelections = c.req.query("includeSelections") === "1";
    const total = Number(result.gallery.photoCount || 0);
    const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") || 50) || 50));
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
