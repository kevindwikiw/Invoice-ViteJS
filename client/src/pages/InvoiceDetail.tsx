import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PDFViewer } from '@react-pdf/renderer'
import { InvoicePDF } from '../components/InvoicePDF'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export const InvoiceDetail = () => {
    // In TanStack Router, we can get params via Route.useParams() if we export the route,
    // or just useParams({ from: '...' }) if using type safety. 
    // For simplicity with this setup, let's assume we pass the id or grab it from generic useParams if available, 
    // but better to rely on the hook provided by the route definition.
    // However, since we define routes in router.tsx, let's use the standard hook and cast or basic approach for now until we tighten typescript.
    const { invoiceId } = useParams({ strict: false }) as { invoiceId: string }

    const { data: invoice, isLoading, error } = useQuery({
        queryKey: ['invoice', invoiceId],
        queryFn: async () => {
            const res = await fetch(`/api/invoices/${invoiceId}`)
            if (!res.ok) throw new Error('Failed to fetch invoice')
            return res.json()
        }
    })

    if (isLoading) {
        return (
            <div className="h-full flex flex-col items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-600 mb-4" />
                <p className="text-gray-500">Loading invoice...</p>
            </div>
        )
    }

    if (error || !invoice) {
        return (
            <div className="p-8 text-center text-red-500">
                <p>Error loading invoice. Please try again.</p>
                <Link to="/" className="text-primary-600 underline mt-4 block">Return to Dashboard</Link>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col p-6 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Link to="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft className="h-5 w-5 text-gray-600" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Invoice #{invoice.invoiceNo}</h1>
                        <p className="text-sm text-gray-500">{invoice.clientName} • {invoice.date}</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                <PDFViewer width="100%" height="100%" className="w-full h-full">
                    <InvoicePDF invoice={invoice} />
                </PDFViewer>
            </div>
        </div>
    )
}
