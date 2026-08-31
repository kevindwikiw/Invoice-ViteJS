import type {
    FeaturePermission,
    PermissionOverrideMode,
    User,
    UserPermissionResponse,
    UserRole,
} from '../../context/auth';

export type RoleFilter = 'all' | UserRole;
export type AccessFilter = 'all' | 'custom' | 'default';
export type MemberSort = 'name-asc' | 'name-desc' | 'newest' | 'oldest';

export interface MemberFilters {
    search: string;
    role: RoleFilter;
    access: AccessFilter;
    sort: MemberSort;
    limit: number;
}

export interface CreateMemberInput {
    name: string;
    email: string;
    password: string;
    role: UserRole;
}

export interface ResetPasswordInput {
    userId: number;
    password: string;
}

export interface UpdatePermissionsInput {
    userId: number;
    overrides: Record<FeaturePermission, PermissionOverrideMode>;
}

export interface UserActivityLog {
    id: number;
    action: string;
    targetUserId?: number | null;
    targetUserName?: string | null;
    targetUserEmail?: string | null;
    actorId?: number | null;
    actorEmail?: string | null;
    actorName?: string | null;
    actorRole?: string | null;
    details?: string | null;
    ipAddress?: string | null;
    createdAt?: string | null;
}

export interface UserAuditFilters {
    search: string;
    action: string;
    limit: number;
    page: number;
}

export interface UserActivityStats {
    total: number;
    created: number;
    deleted: number;
    accessUpdated: number;
    passwordReset: number;
}

export interface UserActivityPage {
    items: UserActivityLog[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    stats: UserActivityStats;
}

export type UserActivityApiResponse = UserActivityPage | UserActivityLog[];

export const ROLE_FEATURE_DEFAULTS: Record<UserRole, Record<FeaturePermission, boolean>> = {
    superadmin: {
        view_market_insights: true,
        view_billing_history: true,
        edit_billing_history: true,
        view_audit_logs: true,
        view_feedback_inbox: true,
        manage_client_galleries: true,
    },
    admin: {
        view_market_insights: true,
        view_billing_history: true,
        edit_billing_history: true,
        view_audit_logs: true,
        view_feedback_inbox: true,
        manage_client_galleries: true,
    },
    employee: {
        view_market_insights: false,
        view_billing_history: true,
        edit_billing_history: false,
        view_audit_logs: false,
        view_feedback_inbox: false,
        manage_client_galleries: false,
    },
};

export const PERMISSION_ROWS: Array<{
    key: FeaturePermission;
    label: string;
    description: string;
}> = [
    {
        key: 'view_market_insights',
        label: 'Market Insights',
        description: 'View revenue, trends, and performance analytics.',
    },
    {
        key: 'view_billing_history',
        label: 'Billing History',
        description: 'View invoices, payments, and transaction receipts.',
    },
    {
        key: 'edit_billing_history',
        label: 'Invoice Management',
        description: 'Create invoices and update billing records.',
    },
    {
        key: 'view_audit_logs',
        label: 'Audit Logs',
        description: 'Review invoice and workspace activity.',
    },
    {
        key: 'view_feedback_inbox',
        label: 'Feedback Inbox',
        description: 'Review client feedback submissions and private photos.',
    },
    {
        key: 'manage_client_galleries',
        label: 'Client Galleries',
        description: 'Create culling galleries, sync Google Drive photos, and export selections.',
    },
];

export const USER_AUDIT_ACTIONS = [
    { value: 'ALL', label: 'All activity' },
    { value: 'USER_CREATED', label: 'Created' },
    { value: 'USER_DELETED', label: 'Deleted' },
    { value: 'USER_PERMISSIONS_UPDATED', label: 'Access updated' },
    { value: 'USER_PASSWORD_RESET', label: 'Password reset' },
];

export const DEFAULT_MEMBER_FILTERS: MemberFilters = {
    search: '',
    role: 'all',
    access: 'all',
    sort: 'name-asc',
    limit: 25,
};

export function hasCustomAccess(member: User): boolean {
    const effective = member.featurePermissions;
    if (!effective) return false;
    const defaults = ROLE_FEATURE_DEFAULTS[member.role];
    return PERMISSION_ROWS.some(({ key }) => effective[key] !== defaults[key]);
}

export function normalizePermissions(
    data: UserPermissionResponse,
    role: User['role'],
): UserPermissionResponse {
    const normalizedPermissions = PERMISSION_ROWS.map(({ key }) => {
        const permission = data.permissions.find((item) => item.key === key);
        const defaultEffective = ROLE_FEATURE_DEFAULTS[role][key];
        return {
            key,
            effective: permission?.effective ?? defaultEffective,
            override: permission?.override === 'inherit'
                ? defaultEffective ? 'grant' : 'deny'
                : permission?.override ?? (defaultEffective ? 'grant' : 'deny'),
        };
    });

    return {
        ...data,
        permissions: normalizedPermissions,
    };
}

