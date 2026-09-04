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
        manage_users: true,
        manage_packages: true,
        delete_packages: true,
        create_invoices: true,
        edit_invoices: true,
        download_invoices: true,
        delete_history: true,
        view_market_insights: true,
        view_billing_history: true,
        edit_billing_history: true,
        view_audit_logs: true,
        view_feedback_inbox: true,
        manage_client_galleries: true,
    },
    admin: {
        manage_users: true,
        manage_packages: true,
        delete_packages: true,
        create_invoices: true,
        edit_invoices: true,
        download_invoices: true,
        delete_history: true,
        view_market_insights: true,
        view_billing_history: true,
        edit_billing_history: true,
        view_audit_logs: true,
        view_feedback_inbox: true,
        manage_client_galleries: true,
    },
    employee: {
        manage_users: false,
        manage_packages: false,
        delete_packages: false,
        create_invoices: true,
        edit_invoices: true,
        download_invoices: true,
        delete_history: false,
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
        key: 'create_invoices',
        label: 'Generate Invoice',
        description: 'Create new invoices from package bundles and billing details.',
    },
    {
        key: 'edit_invoices',
        label: 'Edit Invoices',
        description: 'Update invoices and manage payment proof attachments.',
    },
    {
        key: 'download_invoices',
        label: 'Download Invoices',
        description: 'Export invoice PDFs and selection files when available.',
    },
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
        description: 'Access billing management tools kept for older permission profiles.',
    },
    {
        key: 'delete_history',
        label: 'Delete / Archive History',
        description: 'Archive, restore, or permanently delete billing history.',
    },
    {
        key: 'manage_packages',
        label: 'Package Bundles',
        description: 'Create and update service package bundles.',
    },
    {
        key: 'delete_packages',
        label: 'Delete Packages',
        description: 'Remove service package bundles from the catalog.',
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
    {
        key: 'manage_users',
        label: 'Team & Access',
        description: 'Create users, reset passwords, and control feature access.',
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

