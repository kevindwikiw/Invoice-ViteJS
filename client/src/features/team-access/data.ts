import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import {
    type User,
    type UserPermissionResponse,
} from '../../context/auth';
import { fetchWithAuth } from '../../lib/api';
import type {
    CreateMemberInput,
    ResetPasswordInput,
    UpdatePermissionsInput,
    UserActivityApiResponse,
    UserAuditFilters,
} from './model';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetchWithAuth(url, options);
    const data = await response.json().catch(() => null) as T | { error?: string } | null;

    if (!response.ok) {
        const message = data && typeof data === 'object' && 'error' in data
            ? data.error
            : undefined;
        throw new Error(message || `Request failed with status ${response.status}`);
    }

    return data as T;
}

const api = {
    members: () => requestJson<User[]>('/users'),
    createMember: (input: CreateMemberInput) => requestJson('/users', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    deleteMember: (userId: number) => requestJson(`/users/${userId}`, { method: 'DELETE' }),
    permissions: (userId: number) => requestJson<UserPermissionResponse>(`/users/${userId}/permissions`),
    updatePermissions: (input: UpdatePermissionsInput) => requestJson<UserPermissionResponse>(
        `/users/${input.userId}/permissions`,
        {
            method: 'PUT',
            body: JSON.stringify({ overrides: input.overrides }),
        },
    ),
    resetPassword: (input: ResetPasswordInput) => requestJson(`/users/${input.userId}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: input.password }),
    }),
    userAudit: (filters: UserAuditFilters) => {
        const params = new URLSearchParams({ limit: String(filters.limit), page: String(filters.page) });
        if (filters.search.trim()) params.set('search', filters.search.trim());
        if (filters.action !== 'ALL') params.set('action', filters.action);
        return requestJson<UserActivityApiResponse>(`/users/activity?${params.toString()}`);
    },
};

export const teamAccessKeys = {
    root: ['team-access'] as const,
    members: () => [...teamAccessKeys.root, 'members'] as const,
    permission: (userId: number | null) => [...teamAccessKeys.root, 'permission', userId] as const,
    audits: () => [...teamAccessKeys.root, 'audit'] as const,
    audit: (filters: UserAuditFilters) => [...teamAccessKeys.audits(), filters] as const,
};

export function useMembersQuery(enabled: boolean) {
    return useQuery({
        queryKey: teamAccessKeys.members(),
        queryFn: api.members,
        enabled,
        staleTime: 30_000,
    });
}

export function useMemberPermissionQuery(userId: number | null) {
    return useQuery({
        queryKey: teamAccessKeys.permission(userId),
        queryFn: () => api.permissions(userId as number),
        enabled: userId !== null,
        staleTime: 30_000,
    });
}

export function useUserAuditQuery(filters: UserAuditFilters, enabled: boolean) {
    return useQuery({
        queryKey: teamAccessKeys.audit(filters),
        queryFn: () => api.userAudit(filters),
        enabled,
        staleTime: 15_000,
        placeholderData: keepPreviousData,
    });
}

function useInvalidatingMutation<TInput>(
    mutationFn: (input: TInput) => Promise<unknown>,
    invalidateAudit = true,
) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: teamAccessKeys.members() });
            if (invalidateAudit) {
                await queryClient.invalidateQueries({ queryKey: teamAccessKeys.audits() });
            }
        },
    });
}

export function useCreateMemberMutation() {
    return useInvalidatingMutation(api.createMember);
}

export function useDeleteMemberMutation() {
    return useInvalidatingMutation(api.deleteMember);
}

export function useResetPasswordMutation() {
    return useInvalidatingMutation(api.resetPassword);
}

export function useUpdatePermissionsMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.updatePermissions,
        onSuccess: (data, input) => {
            queryClient.setQueryData(teamAccessKeys.permission(input.userId), data);
            void queryClient.invalidateQueries({ queryKey: teamAccessKeys.members() });
            void queryClient.invalidateQueries({ queryKey: teamAccessKeys.audits() });
        },
    });
}

