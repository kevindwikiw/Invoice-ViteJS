import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, fetchWithAuth } from '../../lib/api';

export type FeedbackStatus = 'new' | 'reviewed';

export const FEEDBACK_TAGS = [
    'Relaxed & Fun',
    'Light & Airy',
    'Friendly Team',
    'Natural Direction',
    'Cinematic Film',
    'Professional Service',
] as const;

export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];

export type PublicFeedbackInput = {
    clientName?: string;
    rating: 1 | 2 | 3 | 4 | 5;
    tags?: FeedbackTag[];
    note?: string;
    photo?: File | null;
};

export type FeedbackItem = {
    id: number;
    invoiceId: number | null;
    invoiceNo: string;
    clientName: string | null;
    rating: number;
    tags: string[];
    message: string;
    hasPhoto: boolean;
    status: FeedbackStatus;
    reviewedBy: number | null;
    reviewedAt: string | null;
    createdAt: string;
};

export type FeedbackListResponse = {
    items: FeedbackItem[];
    total: number;
    newCount: number;
    summary: {
        total: number;
        newCount: number;
        averageRating: number;
        ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>;
    };
    page: number;
    limit: number;
};

export type FeedbackFilters = {
    status: 'all' | FeedbackStatus;
    search: string;
    page: number;
    limit: number;
};

async function responseError(response: Response, fallback: string): Promise<Error> {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return new Error(body?.error || fallback);
}

export async function submitPublicFeedback(input: PublicFeedbackInput): Promise<void> {
    const form = new FormData();
    form.set('clientName', input.clientName?.trim() || '');
    form.set('rating', String(input.rating));
    form.set('tags', JSON.stringify(input.tags ?? []));
    form.set('note', input.note?.trim() || '');
    if (input.photo) form.set('photo', input.photo, input.photo.name);

    const response = await apiFetch('/public/feedback', {
        method: 'POST',
        body: form,
    });
    if (!response.ok) {
        const submissionError = await responseError(response, 'Unable to submit feedback.');
        if (submissionError.message === 'Invalid JSON payload.') {
            throw new Error('The feedback server is still running an older version. Please try again after it has been restarted.');
        }
        throw submissionError;
    }
}

export async function fetchFeedbackPhoto(id: number): Promise<Blob> {
    const response = await fetchWithAuth(`/feedback/${id}/photo`);
    if (!response.ok) throw await responseError(response, 'Unable to load feedback photo.');
    return await response.blob();
}

async function fetchFeedback(filters: FeedbackFilters): Promise<FeedbackListResponse> {
    const params = new URLSearchParams({
        page: String(filters.page),
        limit: String(filters.limit),
    });
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.search.trim()) params.set('search', filters.search.trim());

    const response = await fetchWithAuth(`/feedback?${params.toString()}`);
    if (!response.ok) throw await responseError(response, 'Unable to load feedback.');
    const data = await response.json() as FeedbackListResponse;
    return {
        ...data,
        items: (Array.isArray(data.items) ? data.items : []).map((item) => ({
            ...item,
            clientName: typeof item.clientName === 'string' && item.clientName.trim() ? item.clientName : null,
            tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
            hasPhoto: item.hasPhoto === true,
        })),
    };
}

export function useFeedbackQuery(filters: FeedbackFilters, enabled = true) {
    return useQuery({
        queryKey: ['feedback', filters],
        queryFn: () => fetchFeedback(filters),
        enabled,
        staleTime: 60 * 1000,
    });
}

export function useUpdateFeedbackStatusMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, status }: { id: number; status: FeedbackStatus }) => {
            const response = await fetchWithAuth(`/feedback/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            if (!response.ok) throw await responseError(response, 'Unable to update feedback.');
            return await response.json() as { success: true; status: FeedbackStatus };
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback'] }),
    });
}
