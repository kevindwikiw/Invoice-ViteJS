import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { galleryAll, galleryBatch, galleryInsertReturningId, galleryOne, galleryRun } from "../db/galleries";
import { fetchDriveFile, getDrivePhotoMetadata, getReadonlyDriveToken } from "../lib/google-drive";
import { FACE_MODEL_VERSION, facePhotoVersion, faceSourceVersion } from "../lib/face-model";
import { FaceSourceChanged, getFaceSourceVersion } from "../lib/face-source";

type Env = {
    Variables: {
        user?: { sub: number; email: string; name: string; role: string };
    };
};

type GalleryPhoto = {
    id: number;
    galleryId: number;
    driveFileId: string;
    filename: string;
    mimeType: string;
    thumbnailUrl?: string | null;
    width?: number | null;
    height?: number | null;
    displayOrder: number;
    createdAt: string;
    sourceVersion?: string;
};

type FaceIndexJob = {
    id: number;
    galleryId: number;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    modelVersion: string;
    sourceVersion: string;
    total: number;
    processed: number;
    error?: string | null;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    updatedAt: string;
};

type FaceEmbedding = {
    driveFileId: string;
    faceIndex: number;
    embedding: number[];
    boundingBox?: { x: number; y: number; width: number; height: number } | null;
    sourceVersion: string;
    modelVersion: string;
};

const MODEL_VERSION = FACE_MODEL_VERSION;
const WORKER_URL = process.env.FACE_WORKER_URL?.trim().replace(/\/$/, "") || "";
const WORKER_TOKEN = process.env.FACE_WORKER_TOKEN?.trim() || "";
const INTERNAL_TOKEN = process.env.FACE_WORKER_INTERNAL_TOKEN?.trim() || "";
const MAX_PHOTOS_PER_JOB = 10_000;
const STALE_JOB_MS = 2 * 60 * 1000;
const pendingJobs = new Map<number, Promise<FaceIndexJob | null>>();

export const faceIndexRouter = new Hono<Env>();
const MAX_SELFIE_BYTES = 4 * 1024 * 1024;
export const faceSearchBodyLimit = bodyLimit({
    maxSize: MAX_SELFIE_BYTES + 64 * 1024,
    onError: (c) => c.json({ error: "Selfie image is too large. Please choose a smaller image.", code: "selfie_too_large" }, 413),
});
faceIndexRouter.use("/search", faceSearchBodyLimit);

faceIndexRouter.post("/drive-token", async (c) => {
    c.header("Cache-Control", "no-store");
    if (!internalAuthorized(c)) return jsonError(c, "Unauthorized.", 401);
    try {
        return c.json(await getReadonlyDriveToken(c.req.query("refresh") === "1"));
    } catch {
        console.warn("[face-index] code=drive_token_unavailable");
        return jsonError(c, "Drive authorization is temporarily unavailable.", 503, "drive_token_unavailable");
    }
});

function internalAuthorized(c: Context<Env>): boolean {
    return Boolean(INTERNAL_TOKEN && c.req.header("x-face-worker-token") === INTERNAL_TOKEN);
}

function workerConfigured(): boolean {
    return Boolean(WORKER_URL && WORKER_TOKEN && INTERNAL_TOKEN);
}

function jsonError(c: Context<Env>, error: string, status = 400, code?: string) {
    return c.json({ error, ...(code ? { code } : {}) }, status as 400 | 401 | 404 | 409 | 413 | 422 | 500 | 502 | 503);
}

async function workerReadiness(): Promise<{ ready: boolean; code?: string }> {
    if (!workerConfigured()) return { ready: false, code: "worker_not_configured" };
    try {
        const response = await fetch(`${WORKER_URL}/readyz`, {
            headers: { Authorization: `Bearer ${WORKER_TOKEN}` },
            signal: AbortSignal.timeout(3_000),
        });
        const payload = await response.json().catch(() => null) as { code?: string; model?: string; capabilities?: string[] } | null;
        if (response.ok) return payload?.model === MODEL_VERSION
            ? ["embedding-cache-v1", "drive-direct-v1"].every((capability) => payload.capabilities?.includes(capability)) ? { ready: true } : { ready: false, code: "worker_update_required" }
            : { ready: false, code: "model_version_mismatch" };
        return { ready: false, code: payload?.code || "worker_not_ready" };
    } catch {
        return { ready: false, code: "worker_offline" };
    }
}

function jobShape(row: Record<string, unknown>): FaceIndexJob {
    return {
        id: Number(row.id),
        galleryId: Number(row.galleryId ?? row.gallery_id),
        status: String(row.status) as FaceIndexJob["status"],
        modelVersion: String(row.modelVersion ?? row.model_version ?? MODEL_VERSION),
        sourceVersion: String(row.sourceVersion ?? row.source_version ?? ""),
        total: Number(row.total || 0),
        processed: Number(row.processed || 0),
        error: row.error == null ? null : String(row.error),
        createdAt: String(row.createdAt ?? row.created_at ?? ""),
        startedAt: row.startedAt == null && row.started_at == null ? null : String(row.startedAt ?? row.started_at),
        completedAt: row.completedAt == null && row.completed_at == null ? null : String(row.completedAt ?? row.completed_at),
        updatedAt: String(row.updatedAt ?? row.updated_at ?? ""),
    };
}

async function getGalleryPhotos(galleryId: number): Promise<GalleryPhoto[]> {
    return galleryAll<GalleryPhoto>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", width, height, display_order as "displayOrder", created_at as "createdAt", source_version as "sourceVersion"
        FROM gallery_photos WHERE gallery_id = ? ORDER BY display_order, filename
    `, [galleryId]);
}

async function dispatchJob(jobId: number, galleryId: number, sourceVersion: string, photos: GalleryPhoto[]): Promise<void> {
    if (!workerConfigured()) {
        await galleryRun("UPDATE face_index_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", ["Face worker is not configured.", jobId]);
        return;
    }
    const readiness = await workerReadiness();
    if (!readiness.ready) throw new Error(readiness.code || "worker_not_ready");

    const origin = process.env.FACE_WORKER_CALLBACK_ORIGIN?.trim() || process.env.PUBLIC_API_ORIGIN?.trim() || "";
    if (!origin) {
        await galleryRun("UPDATE face_index_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", ["FACE_WORKER_CALLBACK_ORIGIN is not configured.", jobId]);
        return;
    }

    const indexed = await galleryAll<{ driveFileId: string; sourceVersion: string }>(
        'SELECT drive_file_id as "driveFileId", source_version as "sourceVersion" FROM face_index_photos WHERE gallery_id = ? AND model_version = ?',
        [galleryId, MODEL_VERSION],
    );
    const versions = new Map(indexed.map((photo) => [photo.driveFileId, photo.sourceVersion]));
    const stored = await galleryAll<{ driveFileId: string; faceIndex: number; embedding: string; boundingBox: string | null; sourceVersion: string }>(
        'SELECT drive_file_id as "driveFileId", face_index as "faceIndex", embedding, bounding_box as "boundingBox", source_version as "sourceVersion" FROM face_embeddings WHERE gallery_id = ? AND model_version = ?',
        [galleryId, MODEL_VERSION],
    );
    const cached = new Map<string, unknown[]>();
    for (const face of stored) {
        if (versions.get(face.driveFileId) !== face.sourceVersion) continue;
        const faces = cached.get(face.driveFileId) || [];
        faces.push({ ...face, embedding: JSON.parse(face.embedding), boundingBox: face.boundingBox ? JSON.parse(face.boundingBox) : null });
        cached.set(face.driveFileId, faces);
    }
    await galleryRun("UPDATE face_index_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'", [jobId]);
    const response = await fetch(`${WORKER_URL}/v1/index/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_TOKEN}` },
        body: JSON.stringify({
            jobId,
            galleryId,
            modelVersion: MODEL_VERSION,
            sourceVersion,
            photoSource: "drive",
            photos: photos.map((photo) => ({
                driveFileId: photo.driveFileId,
                thumbnailUrl: photo.thumbnailUrl || null,
                filename: photo.filename,
                mimeType: photo.mimeType,
                displayOrder: photo.displayOrder,
                sourceVersion: facePhotoVersion(photo),
                ...(versions.get(photo.driveFileId) === facePhotoVersion(photo)
                    ? { cachedFaces: cached.get(photo.driveFileId) || [] }
                    : {}),
            })),
        }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        await galleryRun("UPDATE face_index_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')", [`Worker rejected the job (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`, jobId]);
        return;
    }
    await galleryRun("UPDATE face_index_jobs SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'", [jobId]);
}

async function createOrReuseJob(galleryId: number, dispatch = true): Promise<FaceIndexJob | null> {
    const pending = pendingJobs.get(galleryId);
    if (pending) return pending;
    const operation = createJob(galleryId, dispatch);
    pendingJobs.set(galleryId, operation);
    try {
        return await operation;
    } finally {
        pendingJobs.delete(galleryId);
    }
}

async function createJob(galleryId: number, dispatch: boolean): Promise<FaceIndexJob | null> {
    const gallery = await galleryOne<{ syncedAt?: string | null; updatedAt?: string | null; photoCount?: number }>(
        "SELECT synced_at as syncedAt, updated_at as updatedAt, photo_count as photoCount FROM galleries WHERE id = ?",
        [galleryId],
    );
    if (!gallery) return null;
    const photos = await getGalleryPhotos(galleryId);
    const sourceVersion = faceSourceVersion(photos);
    if (sourceVersion !== await getFaceSourceVersion(galleryId)) throw new FaceSourceChanged();
    await currentJob(galleryId); // Expire stale work before reusing an active job.
    const existing = await galleryOne<Record<string, unknown>>(`
        SELECT id, gallery_id as "galleryId", status, model_version as "modelVersion", source_version as "sourceVersion", total, processed, error,
               created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt", updated_at as "updatedAt"
        FROM face_index_jobs
        WHERE gallery_id = ? AND model_version = ? AND source_version = ? AND status IN ('queued', 'running', 'completed')
        ORDER BY id DESC LIMIT 1
    `, [galleryId, MODEL_VERSION, sourceVersion]);
    if (existing) return jobShape(existing);

    if (photos.length > MAX_PHOTOS_PER_JOB) throw new Error(`Gallery has too many photos for one indexing job (max ${MAX_PHOTOS_PER_JOB}).`);
    const id = await galleryInsertReturningId(
        "INSERT INTO face_index_jobs (gallery_id, status, model_version, source_version, total) VALUES (?, 'queued', ?, ?, ?)",
        [galleryId, MODEL_VERSION, sourceVersion, photos.length],
    );
    if (dispatch) {
        try {
            await dispatchJob(id, galleryId, sourceVersion, photos);
        } catch (error) {
            await galleryRun("UPDATE face_index_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')", [String(error), id]);
        }
    }
    return jobShape((await galleryOne<Record<string, unknown>>(`
        SELECT id, gallery_id as "galleryId", status, model_version as "modelVersion", source_version as "sourceVersion", total, processed, error,
               created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt", updated_at as "updatedAt"
        FROM face_index_jobs WHERE id = ?
    `, [id]))!);
}

async function currentJob(galleryId: number): Promise<FaceIndexJob | null> {
    const sourceVersion = await getFaceSourceVersion(galleryId);
    if (sourceVersion === null) return null;
    const row = await galleryOne<Record<string, unknown>>(`
        SELECT id, gallery_id as "galleryId", status, model_version as "modelVersion", source_version as "sourceVersion", total, processed, error,
               created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt", updated_at as "updatedAt"
        FROM face_index_jobs WHERE gallery_id = ? AND model_version = ? AND source_version = ?
        ORDER BY id DESC LIMIT 1
    `, [galleryId, MODEL_VERSION, sourceVersion]);
    if (!row) return null;
    const job = jobShape(row);
    const updatedAt = /Z$|[+-]\d{2}:\d{2}$/.test(job.updatedAt) ? job.updatedAt : `${job.updatedAt.replace(" ", "T")}Z`;
    if ((job.status === "queued" || job.status === "running") && Date.now() - Date.parse(updatedAt) > STALE_JOB_MS) {
        await galleryRun(
            "UPDATE face_index_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')",
            ["Face worker stopped reporting progress.", job.id],
        );
        const stale = await galleryOne<Record<string, unknown>>(`
            SELECT id, gallery_id as "galleryId", status, model_version as "modelVersion", source_version as "sourceVersion", total, processed, error,
                   created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt", updated_at as "updatedAt"
            FROM face_index_jobs WHERE id = ?
        `, [job.id]);
        return stale ? jobShape(stale) : null;
    }
    return job;
}

async function workerSearch(job: FaceIndexJob, selfie: File, sensitivity: string): Promise<Response> {
    const body = new FormData();
    body.append("galleryId", String(job.galleryId));
    body.append("modelVersion", MODEL_VERSION);
    body.append("sensitivity", sensitivity);
    body.append("sourceVersion", job.sourceVersion);
    body.append("completedJobId", String(job.id));
    body.append("selfie", selfie, selfie.name || "selfie.jpg");
    return fetch(`${WORKER_URL}/v1/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${WORKER_TOKEN}` },
        body,
        signal: AbortSignal.timeout(30_000),
    });
}

async function workerSearchError(c: Context<Env>, response: Response, galleryId: number): Promise<Response> {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = payload?.detail;
    const legacyCodes: Record<string, string> = {
        "No face found in the selfie": "no_face",
        "Invalid selfie image": "invalid_selfie",
        "Embeddings payload is too large": "embeddings_too_large",
        "Invalid embeddings payload": "invalid_embeddings",
        "embeddings must be a list": "invalid_embeddings",
        "model_version_mismatch": "model_version_mismatch",
        "Part exceeded maximum size of 1024KB.": "embeddings_too_large",
    };
    const candidate = typeof detail === "object" && detail !== null && "code" in detail
        ? detail.code
        : typeof detail === "string" ? legacyCodes[detail] : undefined;
    const errors: Record<string, { status: number; message: string }> = {
        no_face: { status: 422, message: "No face found. Please choose a clear selfie with your face visible." },
        invalid_selfie: { status: 422, message: "This selfie could not be read. Please choose another image." },
        selfie_too_large: { status: 413, message: "Selfie image is too large. Please choose a smaller image." },
        embeddings_too_large: { status: 413, message: "This gallery exceeds the face-search request limit. Please contact the gallery owner." },
        too_many_embeddings: { status: 413, message: "This gallery has too many faces for one search. Please contact the gallery owner." },
        invalid_search_form: { status: 502, message: "Face search could not process the request. Please try again or contact the gallery owner." },
        invalid_embeddings: { status: 502, message: "This gallery's face index could not be read. Please contact the gallery owner." },
        model_version_mismatch: { status: 503, message: "Face search needs a worker update. Please contact the gallery owner." },
        index_changed: { status: 409, message: "This gallery changed during your search. Please try again." },
        index_unavailable: { status: 503, message: "The face index is temporarily unavailable. Please try again." },
        cache_capacity: { status: 503, message: "This gallery exceeds the worker cache capacity. Please contact the gallery owner." },
        worker_search_failed: { status: 502, message: "Face search is temporarily unavailable. Please try again later." },
    };
    const code = typeof candidate === "string" && Object.hasOwn(errors, candidate) ? candidate : "worker_search_failed";
    const error = errors[code]!;
    // Validation details can contain input; only log/forward allowlisted codes.
    console.warn(`[face-search] gallery=${galleryId} worker_status=${response.status} code=${code}`);
    return jsonError(c, error.message, error.status, code);
}

// Admin/internal control plane. The caller must be authenticated by the
// existing auth middleware when this router is mounted.
faceIndexRouter.post("/jobs", async (c) => {
    if (!c.get("user")) return jsonError(c, "Not authenticated.", 401);
    const body = await c.req.json().catch(() => ({})) as { galleryId?: unknown };
    const galleryId = Number(body.galleryId);
    if (!Number.isInteger(galleryId) || galleryId <= 0) return jsonError(c, "Valid galleryId is required.");
    const gallery = await galleryOne("SELECT id FROM galleries WHERE id = ?", [galleryId]);
    if (!gallery) return jsonError(c, "Gallery not found.", 404);
    try {
        const readiness = await workerReadiness();
        if (!readiness.ready) return jsonError(c, "Face worker is not ready.", 503, readiness.code);
        const job = await createOrReuseJob(galleryId);
        return c.json({ job, workerConfigured: workerConfigured() }, job?.status === "failed" ? 502 : job?.status === "completed" ? 200 : 202);
    } catch (error) {
        return jsonError(c, String(error), 500);
    }
});

faceIndexRouter.get("/jobs/:id", async (c) => {
    if (!c.get("user")) return jsonError(c, "Not authenticated.", 401);
    const job = await galleryOne<Record<string, unknown>>(`
        SELECT id, gallery_id as "galleryId", status, model_version as "modelVersion", source_version as "sourceVersion", total, processed, error,
               created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt", updated_at as "updatedAt"
        FROM face_index_jobs WHERE id = ?
    `, [Number(c.req.param("id"))]);
    if (!job) return jsonError(c, "Face index job not found.", 404);
    return c.json({ job: jobShape(job) });
});

// Worker callback used to publish progress and embeddings without giving the
// VM direct database credentials.
faceIndexRouter.post("/callbacks/jobs/:id/progress", async (c) => {
    if (!internalAuthorized(c)) return jsonError(c, "Unauthorized.", 401);
    const jobId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({})) as { processed?: unknown };
    const processed = Math.max(0, Number(body.processed || 0));
    const result = await galleryRun("UPDATE face_index_jobs SET status = 'running', processed = MIN(total, ?), started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')", [processed, jobId]);
    if (!result.changes) return jsonError(c, "Face index job is no longer active.", 409);
    return c.json({ ok: true });
});

faceIndexRouter.post("/callbacks/jobs/:id/complete", async (c) => {
    if (!internalAuthorized(c)) return jsonError(c, "Unauthorized.", 401);
    const jobId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({})) as { galleryId?: unknown; modelVersion?: unknown; sourceVersion?: unknown; embeddings?: unknown };
    const galleryId = Number(body.galleryId);
    const modelVersion = String(body.modelVersion || MODEL_VERSION);
    const sourceVersion = String(body.sourceVersion || "");
    if (!Array.isArray(body.embeddings)) return jsonError(c, "Embeddings must be an array.");
    const embeddings = body.embeddings as FaceEmbedding[];
    const job = await galleryOne<{ galleryId: number; modelVersion: string; sourceVersion: string; status: string }>(
        "SELECT gallery_id as galleryId, model_version as modelVersion, source_version as sourceVersion, status FROM face_index_jobs WHERE id = ?",
        [jobId],
    );
    if (!job || job.galleryId !== galleryId) return jsonError(c, "Face index job not found.", 404);
    if (job.status !== "running" || job.modelVersion !== modelVersion || job.sourceVersion !== sourceVersion) {
        return jsonError(c, "Face index job is no longer active or does not match its source.", 409);
    }

    const photos = await getGalleryPhotos(galleryId);
    if (faceSourceVersion(photos) !== sourceVersion || (await currentJob(galleryId))?.id !== jobId) {
        return jsonError(c, "Gallery changed during indexing.", 409);
    }
    const versions = new Map(photos.map((photo) => [photo.driveFileId, facePhotoVersion(photo)]));
    const keys = new Set<string>();
    for (const item of embeddings) {
        const key = `${item?.driveFileId}:${item?.faceIndex}`;
        if (!item || versions.get(item.driveFileId) !== item.sourceVersion
            || !Number.isInteger(item.faceIndex) || item.faceIndex < 0 || keys.has(key)
            || !Array.isArray(item.embedding) || item.embedding.length !== 128
            || item.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
            return jsonError(c, "Invalid face embeddings.", 400);
        }
        keys.add(key);
    }

    // Recheck inside the transaction so a stale/failure callback cannot replace
    // an index after a newer callback committed while this request was awaiting IO.
    const active = `EXISTS (SELECT 1 FROM face_index_jobs j JOIN galleries g ON g.id = j.gallery_id
        WHERE j.id = ? AND j.status = 'running' AND g.face_source_version = j.source_version
        AND NOT EXISTS (SELECT 1 FROM face_index_jobs newer WHERE newer.gallery_id = j.gallery_id AND newer.model_version = j.model_version AND newer.id > j.id))`;
    const statements = [
        // Only the latest published snapshot may be reused as a complete index.
        { sql: `UPDATE face_index_jobs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE gallery_id = ? AND model_version = ? AND id < ? AND status IN ('queued', 'running', 'completed') AND ${active}`, params: [galleryId, modelVersion, jobId, jobId] },
        { sql: `DELETE FROM face_embeddings WHERE gallery_id = ? AND model_version = ? AND ${active}`, params: [galleryId, modelVersion, jobId] },
        { sql: `DELETE FROM face_index_photos WHERE gallery_id = ? AND model_version = ? AND ${active}`, params: [galleryId, modelVersion, jobId] },
        ...photos.map((photo) => ({
            sql: `INSERT INTO face_index_photos (gallery_id, drive_file_id, source_version, model_version) SELECT ?, ?, ?, ? WHERE ${active}`,
            params: [galleryId, photo.driveFileId, facePhotoVersion(photo), modelVersion, jobId],
        })),
        ...embeddings.flatMap((item) => {
            if (!item || typeof item.driveFileId !== "string" || !Array.isArray(item.embedding)) return [];
            const vector = item.embedding.map(Number);
            if (!vector.length || vector.some((value) => !Number.isFinite(value))) return [];
            return [{
                sql: `INSERT INTO face_embeddings (gallery_id, drive_file_id, face_index, embedding, bounding_box, source_version, model_version) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${active}`,
                params: [galleryId, item.driveFileId, Number(item.faceIndex || 0), JSON.stringify(vector), item.boundingBox ? JSON.stringify(item.boundingBox) : null, String(item.sourceVersion || ""), modelVersion, jobId],
            }];
        }),
        { sql: `UPDATE face_index_jobs SET status = 'completed', processed = total, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running' AND ${active}`, params: [jobId, jobId] },
    ];
    await galleryBatch(statements);
    const published = await galleryOne<{ status: string }>("SELECT status FROM face_index_jobs WHERE id = ?", [jobId]);
    if (published?.status !== "completed") return jsonError(c, "Face index job is no longer active.", 409);
    return c.json({ ok: true, embeddings: embeddings.length });
});

faceIndexRouter.post("/callbacks/jobs/:id/fail", async (c) => {
    if (!internalAuthorized(c)) return jsonError(c, "Unauthorized.", 401);
    const body = await c.req.json().catch(() => ({})) as { error?: unknown };
    await galleryRun("UPDATE face_index_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')", [String(body.error || "Face index worker failed.").slice(0, 1000), Number(c.req.param("id"))]);
    return c.json({ ok: true });
});

faceIndexRouter.get("/indexes/:jobId", async (c) => {
    if (!internalAuthorized(c)) return jsonError(c, "Unauthorized.", 401);
    const id = Number(c.req.param("jobId"));
    if (!Number.isSafeInteger(id) || id <= 0) return jsonError(c, "Invalid index job.");
    // One SELECT gives both validation and embeddings the same database snapshot.
    // The LEFT JOIN preserves a valid completed index containing zero faces.
    const rows = await galleryAll<{
        galleryId: number; modelVersion: string; sourceVersion: string;
        driveFileId: string | null; faceIndex: number | null; embedding: string | null;
    }>(`
        SELECT j.gallery_id AS "galleryId", j.model_version AS "modelVersion", j.source_version AS "sourceVersion",
            e.drive_file_id AS "driveFileId", e.face_index AS "faceIndex", e.embedding
        FROM face_index_jobs j JOIN galleries g ON g.id = j.gallery_id
        LEFT JOIN face_embeddings e ON e.gallery_id = j.gallery_id AND e.model_version = j.model_version
        WHERE j.id = ? AND j.status = 'completed' AND g.face_source_version = j.source_version
        AND NOT EXISTS (SELECT 1 FROM face_index_jobs newer WHERE newer.gallery_id = j.gallery_id
            AND newer.model_version = j.model_version AND newer.status = 'completed' AND newer.id > j.id)
        ORDER BY e.id
    `, [id]);
    if (!rows.length) return jsonError(c, "Index changed.", 409, "index_changed");
    const first = rows[0]!;
    c.header("Cache-Control", "no-store");
    return c.json({ galleryId: first.galleryId, modelVersion: first.modelVersion, sourceVersion: first.sourceVersion,
        completedJobId: id, embeddings: rows.filter((row) => row.embedding !== null).map((row) => ({
            driveFileId: row.driveFileId, faceIndex: row.faceIndex, embedding: JSON.parse(row.embedding!),
        })) });
});

// The worker uses this endpoint when no local rclone-mounted file is
// available during rolling upgrades. Disabled by default; remove after old jobs drain.
faceIndexRouter.get("/assets/galleries/:galleryId/photos/:fileId", async (c) => {
    if (!internalAuthorized(c)) return jsonError(c, "Unauthorized.", 401);
    if (process.env.FACE_WORKER_LEGACY_ASSET_PROXY !== "1") return c.json({ error: "Legacy photo proxy disabled.", code: "legacy_proxy_disabled" }, 410);
    const galleryId = Number(c.req.param("galleryId"));
    const fileId = c.req.param("fileId");
    const photo = await galleryOne<GalleryPhoto>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", width, height, display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? AND drive_file_id = ?
    `, [galleryId, fileId]);
    if (!photo) return jsonError(c, "Photo not found.", 404);
    let response: Response;
    try {
        response = await fetchDriveFile(photo.driveFileId, photo.thumbnailUrl || undefined, 1280, true);
    } catch {
        let refreshedThumbnail: string | undefined;
        try {
            const refreshed = await getDrivePhotoMetadata(photo.driveFileId);
            refreshedThumbnail = refreshed.thumbnailLink || undefined;
            await galleryRun(`
                UPDATE gallery_photos SET thumbnail_url = ?, web_view_url = ?
                WHERE gallery_id = ? AND drive_file_id = ?
            `, [refreshed.thumbnailLink || null, refreshed.webViewLink || null, galleryId, photo.driveFileId]);
        } catch {
            refreshedThumbnail = undefined;
        }

        try {
            response = await fetchDriveFile(photo.driveFileId, refreshedThumbnail, 1280, true);
        } catch (error) {
            try {
                response = await fetchDriveFile(photo.driveFileId);
            } catch {
                console.error("Face index asset fetch failed", {
                    galleryId,
                    fileId: photo.driveFileId,
                    code: error instanceof Error ? "drive_fetch_failed" : "drive_fetch_unknown",
                });
                return jsonError(c, "Photo source is temporarily unavailable.", 502, "photo_source_unavailable");
            }
        }
    }
    return new Response(response.body, { headers: { "Content-Type": response.headers.get("Content-Type") || photo.mimeType || "image/jpeg", "Cache-Control": "private, max-age=300" } });
});

export type PublicFaceSearchStatus = {
    available: boolean;
    status: "not_indexed" | "indexing" | "ready" | "failed" | "unavailable";
    processed: number;
    total: number;
    code?: string;
};

export async function publicFaceSearchStatus(galleryId: number): Promise<PublicFaceSearchStatus> {
    const readiness = await workerReadiness();
    if (!readiness.ready) {
        return { available: false, status: "unavailable", processed: 0, total: 0, code: readiness.code };
    }
    let job: FaceIndexJob | null;
    try { job = await currentJob(galleryId); }
    catch (error) {
        if (!(error instanceof FaceSourceChanged)) throw error;
        return { available: false, status: "unavailable", processed: 0, total: 0, code: "index_changed" };
    }
    if (!job) return { available: true, status: "not_indexed", processed: 0, total: 0 };
    if (job.status === "completed") return { available: true, status: "ready", processed: job.total, total: job.total };
    if (job.status === "queued" || job.status === "running") {
        return { available: true, status: "indexing", processed: job.processed, total: job.total };
    }
    return { available: true, status: "failed", processed: job.processed, total: job.total, code: "index_failed" };
}

export async function handlePublicFaceSearchStatus(c: Context<Env>, galleryId: number): Promise<Response> {
    return c.json(await publicFaceSearchStatus(galleryId));
}

// Public gallery gateway. It starts indexing on first use and only sends the
// selfie to the worker when a completed embedding index exists.
export async function handlePublicFaceSearch(
    c: Context<Env>,
    galleryId: number,
    serializePhoto: (photo: GalleryPhoto) => unknown = (photo) => photo,
    revalidateAccess?: () => Promise<Response | null>,
): Promise<Response> {
    const readiness = await workerReadiness();
    if (!readiness.ready) return jsonError(c, "Face worker is not ready.", 503, readiness.code);
    const contentLength = Number(c.req.header("content-length") || 0);
    if (contentLength > MAX_SELFIE_BYTES + 64 * 1024) return jsonError(c, "Selfie image is too large.", 413, "selfie_too_large");
    let form: FormData;
    try { form = await c.req.formData(); }
    catch { return jsonError(c, "Invalid selfie form.", 400, "invalid_selfie"); }
    const selfie = form.get("selfie");
    const sensitivity = String(form.get("sensitivity") || "balanced");
    if (!(selfie instanceof File)) return jsonError(c, "Selfie image is required.");
    if (selfie.size > MAX_SELFIE_BYTES) return jsonError(c, "Selfie image is too large.", 413, "selfie_too_large");
    let job: FaceIndexJob | null;
    try {
        job = await currentJob(galleryId);
        if (!job || job.status !== "completed") {
            if (!job || job.status === "failed" || job.status === "cancelled") await createOrReuseJob(galleryId);
            return c.json({ status: "indexing", job: await currentJob(galleryId), matches: [], total: 0 }, 202);
        }
    } catch (error) {
        console.error(`[face-search] Unable to prepare index for gallery ${galleryId}:`, error);
        return jsonError(c, "Face search is temporarily unavailable.", 503);
    }
    try {
        const response = await workerSearch(job, selfie, sensitivity);
        if (!response.ok) {
            return workerSearchError(c, response, galleryId);
        }
        const result = await response.json() as { matches?: Array<{ driveFileId: string; distance: number }>; total?: number };
        const matchIds = new Set((result.matches || []).map((match) => match.driveFileId));
        const photos = await getGalleryPhotos(galleryId);
        const denied = await revalidateAccess?.();
        if (denied) return denied;
        const latest = await currentJob(galleryId);
        if (latest?.id !== job.id || latest.status !== "completed" || latest.sourceVersion !== job.sourceVersion) {
            return jsonError(c, "This gallery changed during your search. Please try again.", 409, "index_changed");
        }
        return c.json({ status: "complete", matches: photos.filter((photo) => matchIds.has(photo.driveFileId)).map(serializePhoto), total: photos.length });
    } catch (error) {
        if (error instanceof FaceSourceChanged) return jsonError(c, "This gallery changed during your search. Please try again.", 409, "index_changed");
        console.error(`[face-search] Worker unavailable for gallery ${galleryId}:`, error);
        return jsonError(c, "Face worker is temporarily unavailable.", 503, "worker_offline");
    }
}

faceIndexRouter.post("/search", async (c) => {
    if (!c.get("user")) return jsonError(c, "Not authenticated.", 401);
    if (!workerConfigured()) return jsonError(c, "Face worker is not configured.", 503);
    let form: FormData;
    try { form = await c.req.formData(); }
    catch { return jsonError(c, "Invalid selfie form.", 400, "invalid_selfie"); }
    const galleryId = Number(form.get("galleryId"));
    const selfie = form.get("selfie");
    const sensitivity = String(form.get("sensitivity") || "balanced");
    if (!Number.isInteger(galleryId) || !(selfie instanceof File)) return jsonError(c, "galleryId and selfie are required.");
    if (selfie.size > MAX_SELFIE_BYTES) return jsonError(c, "Selfie image is too large.", 413, "selfie_too_large");
    try {
        const job = await currentJob(galleryId);
        if (!job || job.status !== "completed") return jsonError(c, "Index is not ready.", 409, "index_changed");
        const response = await workerSearch(job, selfie, sensitivity);
        if (!response.ok) return workerSearchError(c, response, galleryId);
        const latest = await currentJob(galleryId);
        if (latest?.id !== job.id || latest.status !== "completed") return jsonError(c, "Index changed.", 409, "index_changed");
        return new Response(response.body, { status: response.status, headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" } });
    } catch (error) {
        if (error instanceof FaceSourceChanged) return jsonError(c, "Index changed. Please try again.", 409, "index_changed");
        console.error(`[face-search] Internal worker unavailable for gallery ${galleryId}:`, error);
        return jsonError(c, "Face worker is temporarily unavailable.", 503);
    }
});

export { createOrReuseJob, currentJob, MODEL_VERSION, INTERNAL_TOKEN };

export async function prepareGalleryFaceIndex(galleryId: number): Promise<void> {
    try {
        if (!(await workerReadiness()).ready) return;
        await createOrReuseJob(galleryId);
    } catch (error) {
        console.error(`[face-index] Background indexing could not start for gallery ${galleryId}:`, error);
    }
}
