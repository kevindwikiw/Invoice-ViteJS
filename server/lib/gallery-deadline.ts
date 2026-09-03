export const DEFAULT_SELECTION_DURATION_HOURS = 72;
export const MIN_SELECTION_DURATION_HOURS = 1;
export const MAX_SELECTION_DURATION_HOURS = 365 * 24;

type GalleryDeadlineStatus = "draft" | "open" | "closed";

type ResolveGalleryDeadlineUpdateInput = {
    existingDurationHours: number | null | undefined;
    existingDeadlineAt: string | null | undefined;
    nextStatus: GalleryDeadlineStatus;
    requestedStatus?: unknown;
    durationWasProvided: boolean;
    requestedDurationHours?: unknown;
    now?: number;
};

export type GalleryDeadlineUpdate = {
    selectionDurationHours: number;
    selectionDeadlineAt: string | null;
    status: GalleryDeadlineStatus;
};

export function parseSelectionDurationHours(value: unknown): number | null {
    const duration = Number(value);
    if (!Number.isInteger(duration) || duration < MIN_SELECTION_DURATION_HOURS || duration > MAX_SELECTION_DURATION_HOURS) return null;
    return duration;
}

export function selectionDeadlineFromNow(durationHours: number, now = Date.now()): string {
    return new Date(now + durationHours * 60 * 60 * 1000).toISOString();
}

export function selectionDeadlineTimestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function isSelectionDeadlineExpired(value: string | null | undefined, now = Date.now()): boolean {
    const timestamp = selectionDeadlineTimestamp(value);
    return timestamp !== null && timestamp <= now;
}

export function selectionDeadlineEpochSeconds(value: string | null | undefined): number | null {
    const timestamp = selectionDeadlineTimestamp(value);
    return timestamp === null ? null : Math.floor(timestamp / 1000);
}

export function resolveGalleryDeadlineUpdate(input: ResolveGalleryDeadlineUpdateInput): GalleryDeadlineUpdate {
    const existingExpired = isSelectionDeadlineExpired(input.existingDeadlineAt, input.now);
    const selectionDurationHours = input.durationWasProvided
        ? parseSelectionDurationHours(input.requestedDurationHours)
        : Number(input.existingDurationHours ?? DEFAULT_SELECTION_DURATION_HOURS);
    if (selectionDurationHours === null) throw new Error("Selection duration must be an integer from 1 to 8760 hours.");

    const selectionDeadlineAt = input.durationWasProvided
        ? selectionDeadlineFromNow(selectionDurationHours, input.now)
        : input.existingDeadlineAt || null;
    if (input.requestedStatus === "open" && existingExpired && !input.durationWasProvided) {
        throw new Error("Set a new selection duration before reopening this expired gallery.");
    }
    if (input.nextStatus === "open" && !selectionDeadlineAt) {
        throw new Error("Set a selection duration before opening this gallery.");
    }

    return {
        selectionDurationHours,
        selectionDeadlineAt,
        status: existingExpired && input.durationWasProvided ? "closed" : input.nextStatus,
    };
}
