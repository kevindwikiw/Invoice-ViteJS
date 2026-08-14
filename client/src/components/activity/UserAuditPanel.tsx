import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
    USER_AUDIT_ACTIONS,
    useUserAuditQuery,
    type UserActivityLog,
} from '../../features/team-access';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
    AuditActionBadge,
    AuditDataState,
    AuditPagination,
    AuditRefine,
    AuditToolbar,
} from './AuditPrimitives';
import { SectionHeading } from '../SectionHeading';

const TIME_FORMATTER = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
});

function formatTime(value?: string | null) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${TIME_FORMATTER.format(date)} WIB`;
}

function actionLabel(action: string) {
    return action.replace(/^USER_/, '').replaceAll('_', ' ');
}

function actionTone(action: string): 'neutral' | 'positive' | 'warning' | 'danger' {
    if (action === 'USER_CREATED') return 'positive';
    if (action === 'USER_DELETED') return 'danger';
    if (action === 'USER_PASSWORD_RESET') return 'warning';
    return 'neutral';
}

export function UserAuditPanel({ enabled, leading }: { enabled: boolean; leading?: ReactNode }) {
    const [search, setSearch] = useState('');
    const [action, setAction] = useState('ALL');
    const [limit, setLimit] = useState(10);
    const [page, setPage] = useState(1);
    const debouncedSearch = useDebouncedValue(search);
    const query = useUserAuditQuery({ search: debouncedSearch, action, limit, page }, enabled);
    const response = query.data;
    const logs = Array.isArray(response) ? response : response?.items ?? [];
    const currentPage = Array.isArray(response) ? 1 : response?.page ?? page;
    const totalPages = Array.isArray(response) ? 1 : response?.totalPages ?? 1;
    const totalLogs = Array.isArray(response) ? response.length : response?.total ?? 0;

    return (
        <>
            <AuditToolbar
                leading={leading}
                actions={[]}
                activeAction={action}
                search={search}
                searchPlaceholder="Search member, actor, or detail..."
                onActionChange={(value) => {
                    setAction(value);
                    setPage(1);
                }}
                onSearchChange={(value) => {
                    setSearch(value);
                    setPage(1);
                }}
                trailing={(
                    <AuditRefine
                        limit={limit}
                        actions={USER_AUDIT_ACTIONS}
                        activeAction={action}
                        onActionChange={(value) => {
                            setAction(value);
                            setPage(1);
                        }}
                        onLimitChange={(value) => {
                            setLimit(value);
                            setPage(1);
                        }}
                    />
                )}
            />
            <SectionHeading
                title="All User Activity"
                subtitle={`USER AUDIT RECORDS (${logs.length} SHOWN / ${totalLogs} TOTAL)`}
            />
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/10">
                <div className="min-w-[980px]">
                    <div className="hidden grid-cols-[1.35fr_.95fr_.95fr_1.05fr_2.2fr] gap-4 border-b border-[var(--border)] bg-[var(--bg-elevated)]/30 px-6 py-3.5 md:grid">
                        {['Member', 'Log Type', 'Actor', 'Timestamp', 'Log Details'].map((heading) => (
                            <span key={heading} className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                                {heading}
                            </span>
                        ))}
                    </div>
                    <AuditDataState
                        loading={query.isLoading}
                        error={query.isError}
                        empty={logs.length === 0}
                        emptyTitle="No user activity"
                        emptyDescription="Try changing the search or activity filter."
                    >
                        <div className="divide-y divide-[var(--border)]/60">
                            {logs.map((log, index) => <UserAuditRow key={log.id} log={log} index={index} />)}
                        </div>
                    </AuditDataState>
                </div>
            </div>
            <AuditPagination
                page={currentPage}
                totalPages={totalPages}
                total={totalLogs}
                limit={limit}
                fetching={query.isFetching}
                onPageChange={setPage}
            />
        </>
    );
}

function UserAuditRow({ log, index }: { log: UserActivityLog; index: number }) {
    const target = log.targetUserName || log.targetUserEmail || 'Unknown member';
    const actor = log.actorName || log.actorEmail || 'System';

    return (
        <div
            className={clsx(
                'group relative grid grid-cols-1 gap-3 px-6 py-4 transition-colors hover:bg-[var(--bg-elevated)]/35 md:grid-cols-[1.35fr_.95fr_.95fr_1.05fr_2.2fr] md:items-start md:gap-4 md:py-5',
                index % 2 === 0 ? 'bg-transparent' : 'bg-[var(--bg-elevated)]/15',
            )}
        >
            <span className="pointer-events-none absolute left-0 top-0 h-full w-[2px] bg-[var(--accent)] opacity-0 transition-opacity group-hover:opacity-70" />
            <div className="min-w-0">
                <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] md:hidden">Member</p>
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{target}</p>
                {log.targetUserEmail && log.targetUserName && (
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{log.targetUserEmail}</p>
                )}
            </div>
            <div className="flex items-center pt-0.5 md:items-start">
                <p className="mr-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] md:hidden">Log Type</p>
                <AuditActionBadge tone={actionTone(log.action)}>
                    {actionLabel(log.action)}
                </AuditActionBadge>
            </div>
            <div className="flex items-center pt-0.5 text-sm text-[var(--text-secondary)]">
                <p className="mr-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] md:hidden">Actor</p>
                <p className="truncate">{actor}</p>
            </div>
            <div className="flex items-center pt-0.5 text-xs text-[var(--text-muted)]">
                <p className="mr-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] md:hidden">Time</p>
                {formatTime(log.createdAt)}
            </div>
            <div className="break-words text-xs leading-relaxed md:border-l-2 md:border-[var(--border)] md:pl-3">
                <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] md:hidden">Log Details</p>
                <p className="text-[var(--text-secondary)]">
                    {log.details || 'User management action performed.'}
                </p>
            </div>
        </div>
    );
}
