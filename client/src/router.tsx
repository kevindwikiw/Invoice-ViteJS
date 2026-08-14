import { createRouter, createRoute, createRootRoute, lazyRouteComponent, Outlet } from '@tanstack/react-router'
import { GlobalSidebar } from './components/GlobalSidebar'

const LoginRoute = lazyRouteComponent(() => import('./pages/Login'))
const PackagesRoute = lazyRouteComponent(() => import('./pages/Packages'))
const CreateInvoiceRoute = lazyRouteComponent(() => import('./pages/CreateInvoice'))
const InvoiceDetailRoute = lazyRouteComponent(() => import('./pages/InvoiceDetail'), 'InvoiceDetail')
const InvoiceHistoryRoute = lazyRouteComponent(() => import('./pages/InvoiceHistory'))
const UserManagementRoute = lazyRouteComponent(() => import('./pages/UserManagement'))
const AnalyticsRoute = lazyRouteComponent(() => import('./pages/Analytics'))
const InvoiceActivityRoute = lazyRouteComponent(() => import('./pages/InvoiceActivity'))

// Root route - Just the shell
const rootRoute = createRootRoute({
    component: () => <Outlet />,
})

// Layout Route (Authenticated Area)
const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_layout',
    component: GlobalSidebar,
})

// Login Route (Unauthenticated)
const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: LoginRoute,
})

// App Routes (Children of GlobalSidebar/Layout)
const indexRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/',
    component: PackagesRoute,
})

const createInvoiceRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/create',
    component: CreateInvoiceRoute,
    validateSearch: (search: Record<string, unknown>) => ({
        editId: search.editId as number | undefined,
    }),
})

const invoiceDetailRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/invoices/$invoiceId',
    component: InvoiceDetailRoute,
})

const historyRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/history',
    component: InvoiceHistoryRoute,
})

// User Management Route (SuperAdmin only - access control in component)
const userManagementRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/users',
    component: UserManagementRoute,
})

const analyticsRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/analytics',
    component: AnalyticsRoute,
})

const auditLogsRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/activity',
    component: InvoiceActivityRoute,
})

// Build Tree
const routeTree = rootRoute.addChildren([
    loginRoute,
    layoutRoute.addChildren([
        indexRoute,
        createInvoiceRoute,
        invoiceDetailRoute,
        historyRoute,
        analyticsRoute,
        auditLogsRoute,
        userManagementRoute
    ])
])

export const router = createRouter({
    routeTree,
    defaultPendingComponent: () => (
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-deep)] text-[var(--text-muted)]">
            <span className="animate-pulse text-xs font-bold uppercase tracking-[0.2em]">Loading workspace</span>
        </div>
    ),
})

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}
