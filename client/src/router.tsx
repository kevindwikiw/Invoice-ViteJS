import { createRouter, createRoute, createRootRoute } from '@tanstack/react-router'
import Dashboard from './pages/Dashboard'
import CreateInvoice from './pages/CreateInvoice'
import { InvoiceDetail } from './pages/InvoiceDetail'
import PackagesPage from './pages/Packages'
import { Layout } from './components/Layout'

// Root route renders the Layout which contains the Outlet for child routes
const rootRoute = createRootRoute({
    component: Layout,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: Dashboard,
})

const createInvoiceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/create',
    component: CreateInvoice,
})

const invoiceDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/invoices/$invoiceId',
    component: InvoiceDetail,
})

const packagesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/packages',
    component: PackagesPage,
})

const routeTree = rootRoute.addChildren([indexRoute, createInvoiceRoute, invoiceDetailRoute, packagesRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}
