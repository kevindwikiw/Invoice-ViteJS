import { useMemo, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import {
    useAuth,
    type FeaturePermission,
    type PermissionOverrideMode,
    type User,
    type UserPermissionResponse,
} from '../context/auth';
import { useToast } from '../context/ToastContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { PAGE_SHELL_CLASS } from '../constants/uiContract';
import { PANEL_CARD_CLASS } from '../constants/invoice';
import {
    AddMemberModal,
    ConfirmAccessModal,
    DEFAULT_MEMBER_FILTERS,
    DeleteMemberModal,
    MemberDirectory,
    ResetPasswordModal,
    hasCustomAccess,
    normalizePermissions,
    useCreateMemberMutation,
    useDeleteMemberMutation,
    useMemberPermissionQuery,
    useMembersQuery,
    useResetPasswordMutation,
    useUpdatePermissionsMutation,
    type CreateMemberInput,
    type MemberFilters,
} from '../features/team-access';

function errorMessage(error: unknown): string | undefined {
    return error instanceof Error ? error.message : undefined;
}

export default function UserManagement() {
    const { user, hasPermission } = useAuth();
    const { addToast } = useToast();
    const canManage = hasPermission('manage_users');
    const [filters, setFilters] = useState<MemberFilters>({ ...DEFAULT_MEMBER_FILTERS });
    const debouncedSearch = useDebouncedValue(filters.search);
    const [openMemberId, setOpenMemberId] = useState<number | null>(null);
    const [permissionDrafts, setPermissionDrafts] = useState<Record<number, UserPermissionResponse>>({});
    const [addOpen, setAddOpen] = useState(false);
    const [resetTarget, setResetTarget] = useState<User | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
    const [accessTarget, setAccessTarget] = useState<User | null>(null);

    const membersQuery = useMembersQuery(canManage);
    const permissionQuery = useMemberPermissionQuery(openMemberId);
    const createMutation = useCreateMemberMutation();
    const deleteMutation = useDeleteMemberMutation();
    const resetMutation = useResetPasswordMutation();
    const updatePermissionsMutation = useUpdatePermissionsMutation();

    const visibleMembers = useMemo(() => {
        const members = membersQuery.data ?? [];
        return user?.role === 'superadmin'
            ? members
            : members.filter((member) => member.role !== 'superadmin');
    }, [membersQuery.data, user?.role]);

    const processedMembers = useMemo(() => {
        const search = debouncedSearch.trim().toLowerCase();
        const filtered = visibleMembers.filter((member) => {
            if (filters.role !== 'all' && member.role !== filters.role) return false;
            const customAccess = hasCustomAccess(member);
            if (filters.access === 'custom' && !customAccess) return false;
            if (filters.access === 'default' && customAccess) return false;
            if (!search) return true;
            return member.name.toLowerCase().includes(search)
                || member.email.toLowerCase().includes(search);
        });

        return filtered.sort((a, b) => {
            if (filters.sort === 'name-asc') return a.name.localeCompare(b.name);
            if (filters.sort === 'name-desc') return b.name.localeCompare(a.name);
            if (filters.sort === 'newest') return b.id - a.id;
            return a.id - b.id;
        });
    }, [debouncedSearch, filters.access, filters.role, filters.sort, visibleMembers]);

    const pagedMembers = processedMembers.slice(0, filters.limit);
    const activeMember = visibleMembers.find((member) => member.id === openMemberId);

    if (!canManage || !user) {
        return (
            <div className={PAGE_SHELL_CLASS}>
                <div className="mx-auto max-w-7xl border border-[var(--border)] bg-[var(--bg-card)] px-6 py-20 text-center">
                    <AlertCircle size={32} className="mx-auto mb-4 text-rose-400" />
                    <h1 className="font-display text-xl font-semibold text-[var(--text-primary)]">Access denied</h1>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">You cannot manage workspace members.</p>
                </div>
            </div>
        );
    }

    const updatePermissionDraft = (key: FeaturePermission, override: PermissionOverrideMode) => {
        if (!openMemberId) return;
        setPermissionDrafts((current) => {
            const draft = current[openMemberId]
                ?? (permissionQuery.data && activeMember
                    ? normalizePermissions(permissionQuery.data, activeMember.role)
                    : undefined);
            if (!draft) return current;
            return {
                ...current,
                [openMemberId]: {
                    ...draft,
                    permissions: draft.permissions.some((permission) => permission.key === key)
                        ? draft.permissions.map((permission) => (
                            permission.key === key ? { ...permission, override } : permission
                        ))
                        : [
                            ...draft.permissions,
                            { key, override, effective: override === 'grant' },
                        ],
                },
            };
        });
    };

    const createMember = (input: CreateMemberInput) => {
        createMutation.mutate(input, {
            onSuccess: () => {
                setAddOpen(false);
                addToast(`${input.name} added to the workspace.`, 'success');
            },
            onError: (error) => addToast(errorMessage(error) || 'Failed to add member.', 'error'),
        });
    };

    const savePermissions = () => {
        if (!accessTarget) return;
        const draft = permissionDrafts[accessTarget.id];
        if (!draft) return;
        const overrides = draft.permissions.reduce((result, permission) => {
            result[permission.key] = permission.override;
            return result;
        }, {} as Record<FeaturePermission, PermissionOverrideMode>);

        updatePermissionsMutation.mutate({ userId: accessTarget.id, overrides }, {
            onSuccess: (data) => {
                setPermissionDrafts((current) => ({
                    ...current,
                    [accessTarget.id]: normalizePermissions(data, accessTarget.role),
                }));
                setAccessTarget(null);
                addToast(`Access updated for ${accessTarget.name}.`, 'success');
            },
            onError: (error) => addToast(errorMessage(error) || 'Failed to update access.', 'error'),
        });
    };

    return (
        <div className={PAGE_SHELL_CLASS}>
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="mb-2 font-display text-2xl font-medium tracking-tight text-[var(--text-primary)] sm:text-3xl md:text-4xl">
                            Team &amp; Access
                        </h1>
                        <p className="label-xs text-[var(--text-muted)] font-sans">
                            STANDARD OPERATING PROCEDURE: WORKSPACE ACCESS &amp; FEATURE PERMISSIONS
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            createMutation.reset();
                            setAddOpen(true);
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-6 py-2.5 label-xs font-bold text-[var(--bg-deep)] transition-opacity hover:opacity-90"
                    >
                        <Plus size={15} />
                        Add member
                    </button>
                </header>

                <section className={`${PANEL_CARD_CLASS} overflow-visible`}>
                    {membersQuery.isLoading ? (
                            <div className="py-20 text-center text-xs text-[var(--text-muted)]">Loading members...</div>
                        ) : membersQuery.isError ? (
                            <div className="py-20 text-center text-sm text-rose-400">Unable to load members.</div>
                        ) : (
                            <MemberDirectory
                                members={pagedMembers}
                                totalMembers={processedMembers.length}
                                filters={filters}
                                setFilters={setFilters}
                                currentUser={user}
                                openMemberId={openMemberId}
                                permissionData={
                                    openMemberId && activeMember && permissionQuery.data
                                        ? permissionDrafts[openMemberId]
                                            ?? normalizePermissions(permissionQuery.data, activeMember.role)
                                        : undefined
                                }
                                permissionLoading={permissionQuery.isLoading}
                                permissionError={errorMessage(permissionQuery.error)}
                                permissionSaving={updatePermissionsMutation.isPending}
                                onToggleMember={(member) => setOpenMemberId((current) => current === member.id ? null : member.id)}
                                onPermissionChange={updatePermissionDraft}
                                onSavePermissions={(member) => {
                                    updatePermissionsMutation.reset();
                                    setAccessTarget(member);
                                }}
                                onResetPassword={(member) => {
                                    resetMutation.reset();
                                    setResetTarget(member);
                                }}
                                onDelete={(member) => {
                                    deleteMutation.reset();
                                    setDeleteTarget(member);
                                }}
                            />
                    )}
                </section>
            </div>

            {addOpen && <AddMemberModal
                open={addOpen}
                allowSuperadmin={user.role === 'superadmin'}
                loading={createMutation.isPending}
                error={errorMessage(createMutation.error)}
                onClose={() => setAddOpen(false)}
                onSubmit={createMember}
            />}
            {resetTarget && <ResetPasswordModal
                member={resetTarget}
                loading={resetMutation.isPending}
                error={errorMessage(resetMutation.error)}
                onClose={() => setResetTarget(null)}
                onSubmit={(password) => {
                    if (!resetTarget) return;
                    resetMutation.mutate({ userId: resetTarget.id, password }, {
                        onSuccess: () => {
                            addToast(`Password updated for ${resetTarget.name}.`, 'success');
                            setResetTarget(null);
                        },
                        onError: (error) => addToast(errorMessage(error) || 'Failed to reset password.', 'error'),
                    });
                }}
            />}
            {accessTarget && <ConfirmAccessModal
                member={accessTarget}
                loading={updatePermissionsMutation.isPending}
                error={errorMessage(updatePermissionsMutation.error)}
                onClose={() => setAccessTarget(null)}
                onConfirm={savePermissions}
            />}
            {deleteTarget && <DeleteMemberModal
                member={deleteTarget}
                loading={deleteMutation.isPending}
                error={errorMessage(deleteMutation.error)}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => {
                    if (!deleteTarget || deleteTarget.id === user.id) return;
                    deleteMutation.mutate(deleteTarget.id, {
                        onSuccess: () => {
                            addToast(`${deleteTarget.name} removed from the workspace.`, 'success');
                            setDeleteTarget(null);
                        },
                        onError: (error) => addToast(errorMessage(error) || 'Failed to remove member.', 'error'),
                    });
                }}
            />}
        </div>
    );
}
