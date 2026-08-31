import { Hono } from "hono";
import { feedbackAll, feedbackOne, feedbackRun, feedbackStorageDriver } from "../db/feedback";
import { fetchDriveFile, uploadDriveFile } from "../lib/google-drive";
import { feedbackRateLimiter } from "../middleware/rate-limit";

type FeedbackStatus = "new" | "reviewed";

type FeedbackRow = {
    id: number;
    invoice_id: number | null;
    invoice_no: string;
    client_name: string | null;
    rating: number;
    tags: string;
    message: string;
    has_photo: number | string;
    status: FeedbackStatus;
    reviewed_by: number | null;
    reviewed_at: string | Date | null;
    created_at: string | Date;
};

type FeedbackPhotoRow = {
    photo_data: ArrayBuffer | Uint8Array | null;
    photo_drive_file_id?: string | null;
    photo_mime: string | null;
};

type FeedbackEnv = {
    Variables: {
        user: { sub: number };
    };
};

type CountRow = {
    count: number | string;
};

type SummaryRow = {
    total: number | string;
    new_count: number | string | null;
    average_rating: number | string | null;
    rating_1: number | string | null;
    rating_2: number | string | null;
    rating_3: number | string | null;
    rating_4: number | string | null;
    rating_5: number | string | null;
};

function normalizeMessage(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

const FEEDBACK_TAGS = new Set([
    "Relaxed & Fun",
    "Light & Airy",
    "Friendly Team",
    "Natural Direction",
    "Cinematic Film",
    "Professional Service",
]);
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_PHOTO_BYTES = 20_000_000;

function parseTags(value: unknown): string[] {
    let candidate: unknown = value;
    if (typeof value === "string") {
        try {
            candidate = JSON.parse(value);
        } catch {
            candidate = [];
        }
    }
    if (!Array.isArray(candidate)) return [];
    return [...new Set(candidate.filter((tag): tag is string => typeof tag === "string" && FEEDBACK_TAGS.has(tag)))];
}

function deserializeTags(value: string): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
    } catch {
        return [];
    }
}

export const publicFeedbackRoutes = new Hono();

publicFeedbackRoutes.post("/", feedbackRateLimiter, async (c) => {
    try {
        const contentType = c.req.header("content-type") || "";
        let body: Record<string, unknown> | null = null;
        let photo: File | null = null;

        if (contentType.includes("multipart/form-data")) {
            const form = await c.req.raw.formData().catch(() => null);
            if (form) {
                body = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
                const uploadedPhoto = form.get("photo");
                photo = uploadedPhoto instanceof File && uploadedPhoto.size > 0 ? uploadedPhoto : null;
            }
        } else {
            body = await c.req.json<Record<string, unknown>>().catch(() => null);
        }
        if (!body) return c.json({ error: "Invalid feedback payload." }, 400);

        const clientName = normalizeMessage(body.clientName || body.name);
        const note = normalizeMessage(body.note || body.message);
        const loved = normalizeMessage(body.loved);
        const improvement = normalizeMessage(body.improvement);
        const tags = parseTags(body.tags);
        const rating = Number(body.rating);

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return c.json({ error: "Rating must be an integer between 1 and 5." }, 400);
        }
        if (clientName.length > 80) return c.json({ error: "Names must not exceed 80 characters." }, 400);
        if (tags.length > 3) return c.json({ error: "Choose up to 3 highlights." }, 400);
        if (note.length > 1_000 || loved.length > 1_000 || improvement.length > 1_000) {
            return c.json({ error: "Feedback note must not exceed 1000 characters." }, 400);
        }
        if (photo && (!PHOTO_TYPES.has(photo.type) || photo.size > MAX_PHOTO_BYTES)) {
            return c.json({ error: photo.size > MAX_PHOTO_BYTES ? "Photo must be 20 MB or smaller." : "Use a JPEG, PNG, WebP, or HEIC photo." }, 400);
        }

        const legacyNotes = [loved, improvement].filter(Boolean).join("\n\n");
        const message = note || legacyNotes || "Rating and highlights only";
        let photoData: Uint8Array | null = null;
        let photoDriveFileId: string | null = null;
        if (photo) {
            const feedbackFolderId = process.env.FEEDBACK_DRIVE_FOLDER_ID?.trim();
            if (feedbackFolderId) {
                const safeName = photo.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "feedback-photo";
                const uploaded = await uploadDriveFile(feedbackFolderId, photo, `${Date.now()}-${safeName}`);
                photoDriveFileId = uploaded.id;
            } else if (feedbackStorageDriver === "turso") {
                return c.json({ error: "Feedback photo storage is not configured." }, 500);
            } else {
                photoData = new Uint8Array(await photo.arrayBuffer());
            }
        }

        await feedbackRun(`
            INSERT INTO feedback (
                invoice_id, invoice_no, client_name, rating, tags, message,
                photo_data, photo_drive_file_id, photo_mime, photo_size, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
        `, [null, "Anonymous", clientName || null, rating, JSON.stringify(tags), message, photoData, photoDriveFileId, photo?.type || null, photo?.size || null]);

        return c.json({ success: true }, 201);
    } catch (error) {
        console.error("Public feedback submission failed:", error);
        return c.json({ error: "Unable to submit feedback right now." }, 500);
    }
});

export const feedbackAdminRoutes = new Hono<FeedbackEnv>();

feedbackAdminRoutes.get("/", async (c) => {
    try {
        const page = Math.max(1, Number.parseInt(c.req.query("page") || "1", 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query("limit") || "10", 10) || 10));
        const statusQuery = c.req.query("status");
        const status: FeedbackStatus | null = statusQuery === "new" || statusQuery === "reviewed"
            ? statusQuery
            : null;
        const search = (c.req.query("search") || "").trim().slice(0, 100);
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (status) {
            conditions.push("status = ?");
            params.push(status);
        }
        if (search) {
            conditions.push("(LOWER(invoice_no) LIKE LOWER(?) OR LOWER(COALESCE(client_name, '')) LIKE LOWER(?) OR LOWER(tags) LIKE LOWER(?) OR LOWER(message) LIKE LOWER(?))");
            const pattern = `%${search}%`;
            params.push(pattern, pattern, pattern, pattern);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const totalRow = await feedbackOne<CountRow>(`SELECT COUNT(*) AS count FROM feedback ${where}`, params);
        const summaryRow = await feedbackOne<SummaryRow>(`
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
                   AVG(rating) AS average_rating,
                   SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS rating_1,
                   SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS rating_2,
                   SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS rating_3,
                   SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS rating_4,
                   SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS rating_5
            FROM feedback
        `);
        const offset = (page - 1) * limit;
        const rows = await feedbackAll<FeedbackRow>(`
            SELECT id, invoice_id, invoice_no, client_name, rating, tags, message,
                   CASE WHEN photo_data IS NULL AND photo_drive_file_id IS NULL THEN 0 ELSE 1 END AS has_photo, status,
                   reviewed_by, reviewed_at, created_at
            FROM feedback
            ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const summary = {
            total: Number(summaryRow?.total || 0),
            newCount: Number(summaryRow?.new_count || 0),
            averageRating: Number(summaryRow?.average_rating || 0),
            ratingCounts: {
                1: Number(summaryRow?.rating_1 || 0),
                2: Number(summaryRow?.rating_2 || 0),
                3: Number(summaryRow?.rating_3 || 0),
                4: Number(summaryRow?.rating_4 || 0),
                5: Number(summaryRow?.rating_5 || 0),
            },
        };

        c.header("Cache-Control", "private, max-age=60");
        return c.json({
            items: rows.map((row) => ({
                id: Number(row.id),
                invoiceId: row.invoice_id === null ? null : Number(row.invoice_id),
                invoiceNo: row.invoice_no,
                clientName: row.client_name,
                rating: Number(row.rating),
                tags: deserializeTags(row.tags),
                message: row.message,
                hasPhoto: Number(row.has_photo) === 1,
                status: row.status,
                reviewedBy: row.reviewed_by === null ? null : Number(row.reviewed_by),
                reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
                createdAt: new Date(row.created_at).toISOString(),
            })),
            total: Number(totalRow?.count || 0),
            newCount: summary.newCount,
            summary,
            page,
            limit,
        });
    } catch (error) {
        console.error("Feedback inbox query failed:", error);
        return c.json({ error: "Unable to load feedback." }, 500);
    }
});

feedbackAdminRoutes.get("/:id/photo", async (c) => {
    try {
        const id = Number.parseInt(c.req.param("id"), 10);
        if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid feedback id." }, 400);

        const row = await feedbackOne<FeedbackPhotoRow>(`
            SELECT photo_data, photo_drive_file_id, photo_mime FROM feedback WHERE id = ?
        `, [id]);
        if (!row?.photo_data && !row?.photo_drive_file_id) return c.json({ error: "Feedback photo not found." }, 404);

        if (row.photo_drive_file_id) {
            const driveResponse = await fetchDriveFile(row.photo_drive_file_id);
            return new Response(driveResponse.body, {
                headers: {
                    "Content-Type": driveResponse.headers.get("Content-Type") || row.photo_mime || "application/octet-stream",
                    "Cache-Control": "private, max-age=3600, stale-while-revalidate=300",
                    "Content-Disposition": "inline",
                },
            });
        }

        const photoData = row.photo_data;
        if (!photoData) return c.json({ error: "Feedback photo not found." }, 404);
        const bytes = photoData instanceof Uint8Array
            ? photoData
            : new Uint8Array(photoData);
        const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return new Response(payload, {
            headers: {
                "Content-Type": row.photo_mime || "application/octet-stream",
                "Cache-Control": "private, no-store",
                "Content-Disposition": "inline",
            },
        });
    } catch (error) {
        console.error("Feedback photo query failed:", error);
        return c.json({ error: "Unable to load feedback photo." }, 500);
    }
});

feedbackAdminRoutes.patch("/:id", async (c) => {
    try {
        const id = Number.parseInt(c.req.param("id"), 10);
        const body = await c.req.json<{ status?: unknown }>().catch(() => null);
        if (!body) return c.json({ error: "Invalid JSON payload." }, 400);
        const status = body.status;
        if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid feedback id." }, 400);
        if (status !== "new" && status !== "reviewed") {
            return c.json({ error: "Status must be new or reviewed." }, 400);
        }

        const user = c.get("user");
        const result = status === "reviewed"
            ? await feedbackRun(`
                UPDATE feedback
                SET status = 'reviewed', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [user?.sub ?? null, id])
            : await feedbackRun(`
                UPDATE feedback
                SET status = 'new', reviewed_by = NULL, reviewed_at = NULL
                WHERE id = ?
            `, [id]);

        if (result.changes === 0) return c.json({ error: "Feedback not found." }, 404);
        return c.json({ success: true, status });
    } catch (error) {
        console.error("Feedback status update failed:", error);
        return c.json({ error: "Unable to update feedback." }, 500);
    }
});
