import { createRouter, createRoute, createRootRoute, Outlet } from '@tanstack/react-router'
import CreateInvoice from './pages/CreateInvoice'
import { InvoiceDetail } from './pages/InvoiceDetail'
import PackagesPage from './pages/Packages'
import Login from './pages/Login'
import UserManagement from './pages/UserManagement'
import { Layout } from './components/Layout'

// Root route - Just the shell
const rootRoute = createRootRoute({
    component: () => <Outlet />,
})


// Layout Route (Authenticated Area)
const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_layout',
    component: Layout,
})

// Login Route (Unauthenticated)
const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: Login,
})

// App Routes (Children of Layout)
const indexRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/',
    component: PackagesPage,
})

const createInvoiceRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/create',
    component: CreateInvoice,
})

const invoiceDetailRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/invoices/$invoiceId',
    component: InvoiceDetail,
})

// User Management Route (SuperAdmin only - access control in component)
const userManagementRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/users',
    component: UserManagement,
})

// Build Tree
const routeTree = rootRoute.addChildren([
    loginRoute,
    layoutRoute.addChildren([
        indexRoute,
        createInvoiceRoute,
        invoiceDetailRoute,
        userManagementRoute
    ])
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}
