import { memo, useRef, useState, useEffect, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
    AlertCircle,
    Check,
    ChevronDown,
    Filter,
    Key,
    Loader2,
    Lock,
    Search,
    Shield,
    Trash2,
    Users,
    X,
} from 'lucide-react';
import clsx from 'clsx';
import {
    getRoleColor,
    getRoleLabel,
    type FeaturePermission,
    type PermissionOverrideMode,
    type User,
    type UserPermissionResponse,
} from '../../context/auth';
import { PERMISSION_ROWS, hasCustomAccess, type MemberFilters } from './model';
import {
    SEARCH_INPUT_CLASS,
    SEGMENT_BUTTON_ACTIVE_CLASS,
    SEGMENT_BUTTON_BASE_CLASS,
    SEGMENT_BUTTON_INACTIVE_CLASS,
    SEGMENT_GROUP_CLASS,
    TABLE_HEAD_TEXT_CLASS,
} from '../../constants/uiContract';
import { SectionHeading } from '../../components/SectionHeading';

const MEMBER_GRID_CLASS = 'md:grid-cols-[minmax(0,1.6fr)_140px_minmax(150px,1fr)_180px] md:gap-4';

interface MemberDirectoryProps {
    members: User[];
    totalMembers: number;
    filters: MemberFilters;
    setFilters: Dispatch<SetStateAction<MemberFilters>>;
    currentUser: User;
    openMemberId: number | null;
    permissionData?: UserPermissionResponse;
    permissionLoading: boolean;
    permissionError?: string;
    permissionSaving: boolean;
    onToggleMember: (member: User) => void;
    onPermissionChange: (key: FeaturePermission, value: PermissionOverrideMode) => void;
    onSavePermissions: (member: User) => void;
    onResetPassword: (member: User) => void;
    onDelete: (member: User) => void;
}

export function MemberDirectory({
    members,
    totalMembers,
    filters,
    setFilters,
    currentUser,
    openMemberId,
    permissionData,
    permissionLoading,
    permissionError,
    permissionSaving,
    onToggleMember,
    onPermissionChange,
    onSavePermissions,
    onResetPassword,
    onDelete,
}: MemberDirectoryProps) {
    const [showRefine, setShowRefine] = useState(false);
    const refineRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const close = (event: MouseEvent) => {
            if (refineRef.current && !refineRef.current.contains(event.target as Node)) setShowRefine(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    const updateFilter = <K extends keyof MemberFilters>(key: K, value: MemberFilters[K]) => {
        setFilters((current) => ({ ...current, [key]: value }));
    };

    return (
        <div className="space-y-6">
            <div className="border-b border-[var(--border)] pb-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center overflow-x-auto no-scrollbar">
                <div className={SEGMENT_GROUP_CLASS}>
                    {[
                        ['all', 'All'],
                        ...(currentUser.role === 'superadmin' ? [['superadmin', 'Super Admin']] : []),
                        ['admin', 'Admin'], ['employee', 'Employee'],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => updateFilter('role', value as MemberFilters['role'])}
                            className={clsx(
                                SEGMENT_BUTTON_BASE_CLASS,
                                filters.role === value ? SEGMENT_BUTTON_ACTIVE_CLASS : SEGMENT_BUTTON_INACTIVE_CLASS,
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex w-full items-center gap-3 xl:w-auto xl:flex-1 xl:justify-end">
                <div className="relative shrink-0" ref={refineRef}>
                    <button
                        type="button"
                        aria-expanded={showRefine}
                        aria-controls="member-refine-panel"
                        onClick={() => setShowRefine((open) => !open)}
                        className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 label-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40"
                    >
                        <Filter size={14} className="text-[var(--text-muted)]" /> Refine
                    </button>
                    <div
                        id="member-refine-panel"
                        className={clsx(
                            'absolute left-0 top-full z-[999] mt-2 w-[min(calc(100vw-3rem),18rem)] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-xl origin-top-left transition-all duration-200',
                            showRefine ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
                        )}
                    >
                        <div className="space-y-3">
                            <FilterSelect label="Access" value={filters.access} onChange={(value) => updateFilter('access', value as MemberFilters['access'])} options={[['all', 'All access'], ['custom', 'Custom access'], ['default', 'Role default']]} />
                            <FilterSelect label="Sort" value={filters.sort} onChange={(value) => updateFilter('sort', value as MemberFilters['sort'])} options={[['name-asc', 'Name A-Z'], ['name-desc', 'Name Z-A'], ['newest', 'Newest'], ['oldest', 'Oldest']]} />
                            <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">Rows
                                <select aria-label="Rows to show" value={filters.limit} onChange={(event) => updateFilter('limit', Number(event.target.value))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none">{[10, 25, 50, 100].map((limit) => <option key={limit}>{limit}</option>)}</select>
                            </label>
                            <button
                                type="button"
                                onClick={() => setFilters((current) => ({ ...current, access: 'all', sort: 'name-asc', limit: 25 }))}
                                className="w-full py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-primary)]"
                            >
                                Reset Refine
                            </button>
                        </div>
                    </div>
                </div>
            <div className="relative min-w-0 flex-1 xl:w-[280px] xl:flex-none">
                <div className="relative">
                    <label htmlFor="member-search" className="sr-only">Search members</label>
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                        id="member-search"
                        type="search"
                        value={filters.search}
                        onChange={(event) => updateFilter('search', event.target.value)}
                        placeholder="Search name or email..."
                        className={SEARCH_INPUT_CLASS}
                        style={{ height: '40px', paddingLeft: '2.5rem' }}
                    />
                </div>
                </div>
                {/* filters moved into Refine */}
                {/* <FilterSelect
                    label="Role"
                    value={filters.role}
                    onChange={(value) => updateFilter('role', value as MemberFilters['role'])}
                    options={[
                        ['all', 'All roles'],
                        ...(currentUser.role === 'superadmin' ? [['superadmin', 'Super admin']] : []),
                        ['admin', 'Admin'],
                        ['employee', 'Employee'],
                    ]}
                />
                <FilterSelect
                    label="Access"
                    value={filters.access}
                    onChange={(value) => updateFilter('access', value as MemberFilters['access'])}
                    options={[
                        ['all', 'All access'],
                        ['custom', 'Custom access'],
                        ['default', 'Role default'],
                    ]}
                />
                <FilterSelect
                    label="Sort"
                    value={filters.sort}
                    onChange={(value) => updateFilter('sort', value as MemberFilters['sort'])}
                    options={[
                        ['name-asc', 'Name A–Z'],
                        ['name-desc', 'Name Z–A'],
                        ['newest', 'Newest'],
                        ['oldest', 'Oldest'],
                    ]}
                /> */}
            </div>
                </div>
            </div>

            <div>
                <SectionHeading title="All Members" subtitle={`ACCESS DIRECTORY (${members.length} SHOWN / ${totalMembers} TOTAL)`} />
            </div>

            {members.length === 0 ? (
                <div className="py-20 text-center">
                    <Users size={25} className="mx-auto mb-3 text-[var(--text-muted)]" />
                    <p className="text-sm font-medium text-[var(--text-primary)]">No matching members</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">Adjust the search or access filters.</p>
                </div>
            ) : (
                <>
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                    <div className={clsx('hidden border-b border-[var(--border)] bg-[var(--bg-elevated)]/30 px-6 py-3 md:grid md:items-center', MEMBER_GRID_CLASS)}>
                        <span className={TABLE_HEAD_TEXT_CLASS}>Member</span>
                        <span className={clsx(TABLE_HEAD_TEXT_CLASS, 'text-center')}>Role</span>
                        <span className={clsx(TABLE_HEAD_TEXT_CLASS, 'text-center')}>Access policy</span>
                        <span className={clsx(TABLE_HEAD_TEXT_CLASS, 'text-center')}>Actions</span>
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                    {members.map((member) => (
                        <MemberRow
                            key={member.id}
                            member={member}
                            currentUser={currentUser}
                            open={openMemberId === member.id}
                            permissionData={openMemberId === member.id ? permissionData : undefined}
                            permissionLoading={openMemberId === member.id && permissionLoading}
                            permissionError={openMemberId === member.id ? permissionError : undefined}
                            permissionSaving={openMemberId === member.id && permissionSaving}
                            onToggle={() => onToggleMember(member)}
                            onPermissionChange={onPermissionChange}
                            onSavePermissions={() => onSavePermissions(member)}
                            onResetPassword={() => onResetPassword(member)}
                            onDelete={() => onDelete(member)}
                        />
                    ))}
                    </div>
                </div>
                </>
            )}
        </div>
    );
}

function FilterSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[][];
    onChange: (value: string) => void;
}) {
    return (
        <label className="relative">
            <span className="sr-only">{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 pr-8 text-xs text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent)]"
            >
                {options.map(([optionValue, optionLabel]) => (
                    <option key={optionValue} value={optionValue}>{optionLabel}</option>
                ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        </label>
    );
}

const MemberRow = memo(function MemberRow({
    member,
    currentUser,
    open,
    permissionData,
    permissionLoading,
    permissionError,
    permissionSaving,
    onToggle,
    onPermissionChange,
    onSavePermissions,
    onResetPassword,
    onDelete,
}: {
    member: User;
    currentUser: User;
    open: boolean;
    permissionData?: UserPermissionResponse;
    permissionLoading: boolean;
    permissionError?: string;
    permissionSaving: boolean;
    onToggle: () => void;
    onPermissionChange: (key: FeaturePermission, value: PermissionOverrideMode) => void;
    onSavePermissions: () => void;
    onResetPassword: () => void;
    onDelete: () => void;
}) {
    const canManageAccess = member.role === 'employee';
    const canReset = currentUser.role === 'superadmin' || member.role !== 'superadmin';
    const customAccess = hasCustomAccess(member);

    const rowInteractive = canManageAccess;
    const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
        if (!rowInteractive || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onToggle();
    };

    return (
        <article
            className={clsx('group', rowInteractive && 'cursor-pointer')}
            role={rowInteractive ? 'button' : undefined}
            tabIndex={rowInteractive ? 0 : undefined}
            aria-expanded={rowInteractive ? open : undefined}
            aria-label={rowInteractive ? `${open ? 'Close' : 'Open'} feature access for ${member.name}` : undefined}
            onClick={rowInteractive ? onToggle : undefined}
            onKeyDown={handleRowKeyDown}
        >
            <div className={clsx('grid min-w-0 gap-4 px-6 py-4 transition-colors hover:bg-[var(--bg-elevated)]/35 md:items-center', MEMBER_GRID_CLASS, rowInteractive && open && 'bg-[var(--accent)]/[0.04]')}>
                    <div className="flex min-w-0 items-center gap-3 font-sans">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-sm font-semibold text-[var(--accent)]">
                        {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold tracking-tight text-[var(--text-primary)]">{member.name}</h3>
                            {member.id === currentUser.id && (
                                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">You</span>
                            )}
                        </div>
                        <p className="truncate text-xs text-[var(--text-muted)]">{member.email}</p>
                    </div>
                </div>

                <div className="flex justify-self-center">
                    <span className={clsx(
                        'inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em]',
                        getRoleColor(member.role),
                    )}>
                        <Shield size={10} />
                        {getRoleLabel(member.role)}
                    </span>
                </div>

                <div className="text-center font-sans md:justify-self-center">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">
                        {customAccess ? 'Custom access' : 'Role default'}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                        {member.role === 'employee' ? 'Feature-level policy' : 'Administrative policy'}
                    </p>
                </div>

                <div className="flex w-[180px] items-center justify-center gap-1.5">
                    {canManageAccess ? (
                        <button type="button" aria-expanded={open} onClick={(event) => { event.stopPropagation(); onToggle(); }} title="Feature access" className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors', open ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)]')}>
                            <Lock size={14} />
                        </button>
                    ) : <span className="h-8 w-8" aria-hidden="true" />}
                    {canReset ? (
                        <button type="button" onClick={(event) => { event.stopPropagation(); onResetPassword(); }} aria-label={`Reset password for ${member.name}`} title="Reset password" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)]">
                            <Key size={14} />
                        </button>
                    ) : <span className="h-8 w-8" aria-hidden="true" />}
                    {member.id !== currentUser.id ? (
                        <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} aria-label={`Delete ${member.name}`} title="Delete member" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-500/20 bg-rose-500/5 text-rose-400 transition-colors hover:bg-rose-500 hover:text-white">
                            <Trash2 size={14} />
                        </button>
                    ) : <span className="h-8 w-8" aria-hidden="true" />}
                </div>
            </div>

            {open && canManageAccess && (
                <PermissionPanel
                    member={member}
                    data={permissionData}
                    loading={permissionLoading}
                    error={permissionError}
                    saving={permissionSaving}
                    onChange={onPermissionChange}
                    onSave={onSavePermissions}
                />
            )}
        </article>
    );
});

function PermissionPanel({
    member,
    data,
    loading,
    error,
    saving,
    onChange,
    onSave,
}: {
    member: User;
    data?: UserPermissionResponse;
    loading: boolean;
    error?: string;
    saving: boolean;
    onChange: (key: FeaturePermission, value: PermissionOverrideMode) => void;
    onSave: () => void;
}) {
    return (
            <div className="border-t border-[var(--border)] bg-[var(--bg-deep)]/45 px-5 py-5 animate-in slide-in-from-top-1 duration-150" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">Feature access</h4>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">Overrides for {member.name} apply immediately after saving.</p>
                </div>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={!data || saving}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-opacity disabled:opacity-40"
                >
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    Save access
                </button>
            </div>

            {error ? (
                <div className="flex items-center gap-2 border-l-2 border-rose-500 px-3 py-2 text-xs text-rose-400">
                    <AlertCircle size={14} /> {error}
                </div>
            ) : loading || !data ? (
                <div className="flex items-center gap-2 py-5 text-xs text-[var(--text-muted)]">
                    <Loader2 size={14} className="animate-spin text-[var(--accent)]" /> Loading permissions
                </div>
            ) : (
                <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                    {PERMISSION_ROWS.map((row) => {
                        const permission = data.permissions.find((item) => item.key === row.key);
                        const allowed = permission?.override === 'grant';
                        return (
                            <div key={row.key} className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-xs font-semibold text-[var(--text-primary)]">{row.label}</p>
                                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{row.description}</p>
                                </div>
                                <div className="flex shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1">
                                    <PermissionButton active={allowed} icon={Check} label="Allow" onClick={() => onChange(row.key, 'grant')} />
                                    <PermissionButton active={!allowed} icon={X} label="Block" danger onClick={() => onChange(row.key, 'deny')} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function PermissionButton({
    active,
    label,
    icon: Icon,
    danger,
    onClick,
}: {
    active: boolean;
    label: string;
    icon: typeof Check;
    danger?: boolean;
    onClick: () => void;
}) {
    const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={clsx(
                'inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[10px] font-semibold transition-colors',
                active
                    ? danger
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--text-secondary)]',
            )}
        >
            <Icon size={11} />
            {label}
        </button>
    );
}

