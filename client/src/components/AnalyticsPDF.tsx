import React from 'react';
import { Page, Text, View, Document, StyleSheet, Font } from '@react-pdf/renderer';
import type { AnalyticsData } from '../pages/Analytics';

// Register a font (optional, standard fonts work)
// Font.register({ family: 'Roboto', src: 'https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-light-webfont.ttf' });

const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        padding: 30,
        fontFamily: 'Helvetica'
    },
    header: {
        marginBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        paddingBottom: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827'
    },
    subtitle: {
        fontSize: 12,
        color: '#6B7280'
    },
    section: {
        margin: 10,
        padding: 10,
    },
    kpiContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
        backgroundColor: '#F9FAFB',
        padding: 15,
        borderRadius: 5
    },
    kpiItem: {
        flexDirection: 'column',
        alignItems: 'center',
        flex: 1
    },
    kpiLabel: {
        fontSize: 10,
        color: '#6B7280',
        textTransform: 'uppercase',
        marginBottom: 4
    },
    kpiValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827'
    },
    table: {
        display: 'flex',
        width: 'auto',
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRightWidth: 0,
        borderBottomWidth: 0,
        marginTop: 20
    },
    tableRow: {
        margin: 'auto',
        flexDirection: 'row'
    },
    tableColHeader: {
        width: '25%',
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderLeftWidth: 0,
        borderTopWidth: 0,
        backgroundColor: '#F3F4F6',
        padding: 8
    },
    tableCol: {
        width: '25%',
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderLeftWidth: 0,
        borderTopWidth: 0,
        padding: 8
    },
    tableCellHeader: {
        margin: 'auto',
        fontSize: 10,
        fontWeight: 'bold',
        color: '#374151'
    },
    tableCell: {
        margin: 'auto',
        fontSize: 10,
        color: '#4B5563'
    },
    footer: {
        position: 'absolute',
        bottom: 30,
        left: 30,
        right: 30,
        textAlign: 'center',
        fontSize: 10,
        color: '#9CA3AF',
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        paddingTop: 10
    }
});

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
};

const AnalyticsPDFComponent = ({ data, year }: { data: AnalyticsData; year: number }) => {
    // Process Data
    const bookings = data.bookings.filter(b => b.year === year);
    const totalRevenue = bookings.reduce((sum, b) => sum + b.amount, 0);

    const months = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const mBookings = bookings.filter(b => b.month === m);
        const count = mBookings.length;
        const revenue = mBookings.reduce((sum, b) => sum + b.amount, 0);
        return {
            name: new Date(2000, i, 1).toLocaleString('default', { month: 'long' }),
            count,
            revenue
        };
    });

    const topVenue = Object.entries(bookings.reduce((acc, b) => {
        acc[b.venue] = (acc[b.venue] || 0) + 1;
        return acc;
    }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>Yearly Analytics Report</Text>
                        <Text style={styles.subtitle}>Generated on {new Date().toLocaleDateString()}</Text>
                    </View>
                    <View>
                        <Text style={{ fontSize: 20, color: '#10B981', fontWeight: 'bold' }}>{year}</Text>
                    </View>
                </View>

                {/* KPI Section */}
                <View style={styles.kpiContainer}>
                    <View style={styles.kpiItem}>
                        <Text style={styles.kpiLabel}>Total Revenue</Text>
                        <Text style={styles.kpiValue}>{formatCurrency(totalRevenue)}</Text>
                    </View>
                    <View style={styles.kpiItem}>
                        <Text style={styles.kpiLabel}>Total Events</Text>
                        <Text style={styles.kpiValue}>{bookings.length}</Text>
                    </View>
                    <View style={styles.kpiItem}>
                        <Text style={styles.kpiLabel}>Top Venue</Text>
                        <Text style={styles.kpiValue}>{topVenue[0]}</Text>
                    </View>
                </View>

                {/* Monthly Breakdown Table */}
                <Text style={{ fontSize: 14, fontWeight: 'bold', marginTop: 20, marginBottom: 10 }}>Monthly Breakdown</Text>

                <View style={styles.table}>
                    <View style={styles.tableRow}>
                        <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Month</Text></View>
                        <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Events</Text></View>
                        <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Revenue</Text></View>
                        <View style={styles.tableColHeader}><Text style={styles.tableCellHeader}>Avg. per Event</Text></View>
                    </View>

                    {months.map((m, i) => (
                        <View style={styles.tableRow} key={i}>
                            <View style={styles.tableCol}><Text style={styles.tableCell}>{m.name}</Text></View>
                            <View style={styles.tableCol}><Text style={styles.tableCell}>{m.count}</Text></View>
                            <View style={styles.tableCol}><Text style={styles.tableCell}>{formatCurrency(m.revenue)}</Text></View>
                            <View style={styles.tableCol}>
                                <Text style={styles.tableCell}>
                                    {m.count > 0 ? formatCurrency(m.revenue / m.count) : '-'}
                                </Text>
                            </View>
                        </View>
                    ))}

                    {/* Total Row */}
                    <View style={[styles.tableRow, { backgroundColor: '#F9FAFB' }]}>
                        <View style={styles.tableCol}><Text style={[styles.tableCell, { fontWeight: 'bold' }]}>TOTAL</Text></View>
                        <View style={styles.tableCol}><Text style={[styles.tableCell, { fontWeight: 'bold' }]}>{bookings.length}</Text></View>
                        <View style={styles.tableCol}><Text style={[styles.tableCell, { fontWeight: 'bold' }]}>{formatCurrency(totalRevenue)}</Text></View>
                        <View style={styles.tableCol}><Text style={styles.tableCell}>-</Text></View>
                    </View>
                </View>

                {/* Footer */}
                <View style={styles.footer}>
                    <Text>Invoice App Analytics • Confidential Report</Text>
                </View>
            </Page>
        </Document>
    );
};

export const AnalyticsPDF = React.memo(AnalyticsPDFComponent);
