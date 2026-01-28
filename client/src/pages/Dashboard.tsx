import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, DollarSign, FileText, CheckCircle } from 'lucide-react';
import { Link } from '@tanstack/react-router';

const StatCard = ({ title, value, subtext, icon: Icon, color }: any) => (
    <div className="bg-white p-6 rounded-xl border border-surface-200 shadow-sm flex items-start justify-between">
        <div>
            <div className="text-surface-500 text-sm font-medium mb-1">{title}</div>
            <div className="text-2xl font-bold text-surface-900">{value}</div>
            <div className="text-surface-400 text-xs mt-2">{subtext}</div>
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
            <Icon size={20} className="text-white" />
        </div>
    </div>
);

export default function Dashboard() {
    const { data: invoices, isLoading, error } = useQuery({
        queryKey: ['invoices'],
        queryFn: async () => {
            const res = await fetch('/api/invoices');
            if (!res.ok) throw new Error('Network error');
            return res.json();
        }
    });

    if (isLoading) return <div className="flex items-center justify-center h-full">Loading data...</div>;
    if (error) return <div className="text-red-500">Error loading dashboard: {String(error)}</div>;

    // Calculate basic stats
    const totalRevenue = invoices?.reduce((sum: number, inv: any) => sum + (inv.totalAmount || 0), 0) || 0;
    const count = invoices?.length || 0;

    return (
        <>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-surface-900">Dashboard</h1>
                <p className="text-surface-500 text-sm mt-1">overview of your business performance.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <StatCard
                    title="Total Revenue"
                    value={`Rp ${totalRevenue.toLocaleString('id-ID')}`}
                    subtext="All time revenue"
                    icon={DollarSign}
                    color="bg-primary-600"
                />
                <StatCard
                    title="Total Invoices"
                    value={count}
                    subtext="Processed invoices"
                    icon={FileText}
                    color="bg-purple-600"
                />
                <StatCard
                    title="Success Rate"
                    value="100%"
                    subtext="Completed orders"
                    icon={CheckCircle}
                    color="bg-blue-600"
                />
            </div>

            <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-surface-200 flex justify-between items-center">
                    <h3 className="font-semibold text-surface-800">Recent Invoices</h3>
                    <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">View All</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-surface-600">
                        <thead className="bg-surface-50 text-surface-900 border-b border-surface-200">
                            <tr>
                                <th className="px-6 py-3 font-medium">Invoice No</th>
                                <th className="px-6 py-3 font-medium">Client</th>
                                <th className="px-6 py-3 font-medium">Date</th>
                                <th className="px-6 py-3 font-medium text-right">Amount</th>
                                <th className="px-6 py-3 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-100">
                            {invoices?.slice(0, 5).map((inv: any) => (
                                <tr key={inv.id} className="hover:bg-surface-50 transition-colors group">
                                    <td className="px-6 py-4 font-medium text-surface-900">
                                        <Link to="/invoices/$invoiceId" params={{ invoiceId: String(inv.id) }} className="text-primary-600 hover:underline">
                                            {inv.invoiceNo}
                                        </Link>
                                    </td>
                                    <td className="px-6 py-4">{inv.clientName}</td>
                                    <td className="px-6 py-4">{inv.date}</td>
                                    <td className="px-6 py-4 text-right font-medium">Rp {inv.totalAmount?.toLocaleString('id-ID')}</td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                            Paid
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );

}
