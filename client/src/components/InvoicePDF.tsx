import { Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
    page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10 },

    // Header
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, borderBottomWidth: 2, borderBottomColor: '#16a34a', paddingBottom: 15 },
    brand: { fontSize: 24, fontWeight: 'bold', color: '#16a34a' },
    invoiceTitle: { fontSize: 18, color: '#333', textAlign: 'right', fontWeight: 'bold' },
    meta: { fontSize: 9, color: '#666', marginTop: 3, textAlign: 'right' },

    // Client Section
    clientSection: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
    clientBox: { width: '48%' },
    label: { fontSize: 8, color: '#999', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
    value: { fontSize: 11, color: '#333' },
    valueSmall: { fontSize: 10, color: '#555' },

    // Table
    table: { marginTop: 20, marginBottom: 20 },
    tableHeader: { flexDirection: 'row', backgroundColor: '#16a34a', padding: 10, borderRadius: 4 },
    tableHeaderText: { color: '#fff', fontWeight: 'bold', fontSize: 9 },
    tableRow: { flexDirection: 'row', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
    tableRowAlt: { backgroundColor: '#f9fafb' },

    colDesc: { width: '50%' },
    colQty: { width: '10%', textAlign: 'center' },
    colPrice: { width: '20%', textAlign: 'right' },
    colTotal: { width: '20%', textAlign: 'right' },

    // Totals
    totalsSection: { marginTop: 20, alignItems: 'flex-end' },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', width: 220, marginBottom: 6, paddingVertical: 3 },
    totalLabel: { fontSize: 10, color: '#666' },
    totalValue: { fontSize: 11, fontWeight: 'bold', color: '#333' },
    grandTotalRow: { borderTopWidth: 2, borderTopColor: '#16a34a', paddingTop: 8, marginTop: 4 },
    grandTotalLabel: { fontSize: 12, fontWeight: 'bold', color: '#333' },
    grandTotalValue: { fontSize: 14, fontWeight: 'bold', color: '#16a34a' },

    // Payment Terms
    paymentSection: { marginTop: 30, padding: 15, backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#bbf7d0' },
    paymentTitle: { fontSize: 10, fontWeight: 'bold', color: '#166534', marginBottom: 10 },
    paymentRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    paymentLabel: { fontSize: 9, color: '#166534' },
    paymentValue: { fontSize: 9, fontWeight: 'bold', color: '#166534' },

    // Footer
    footer: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', fontSize: 8, color: '#999', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }
});

const Currency = (amount: number) => `Rp ${amount.toLocaleString('id-ID')}`;

export const InvoicePDF = ({ invoice }: { invoice: any }) => {
    // Parse stored JSON data
    const data = JSON.parse(invoice.invoiceData || '{}');
    const items = data.items || [];
    const paymentTerms = data.paymentTerms || [];
    const cashback = data.cashback || 0;
    const venue = data.venue || '-';
    const weddingDate = data.weddingDate || invoice.date;
    const clientPhone = data.clientPhone || '';
    const eventTitle = data.eventTitle || '';

    // Calculate subtotal from items
    const subtotal = items.reduce((sum: number, item: any) =>
        sum + ((Number(item.price) || 0) * (Number(item.qty) || 1)), 0
    );

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.brand}>INVOICE</Text>
                        {eventTitle && <Text style={{ fontSize: 10, color: '#666', marginTop: 4 }}>{eventTitle}</Text>}
                    </View>
                    <View>
                        <Text style={styles.invoiceTitle}>{invoice.invoiceNo}</Text>
                        <Text style={styles.meta}>Date: {weddingDate}</Text>
                    </View>
                </View>

                {/* Client & Event Details */}
                <View style={styles.clientSection}>
                    <View style={styles.clientBox}>
                        <Text style={styles.label}>Bill To</Text>
                        <Text style={styles.value}>{invoice.clientName}</Text>
                        {clientPhone && <Text style={styles.valueSmall}>📱 {clientPhone}</Text>}
                    </View>
                    <View style={styles.clientBox}>
                        <Text style={styles.label}>Event Location</Text>
                        <Text style={styles.value}>{venue}</Text>
                        <Text style={styles.valueSmall}>📅 {weddingDate}</Text>
                    </View>
                </View>

                {/* Items Table */}
                <View style={styles.table}>
                    {/* Header */}
                    <View style={styles.tableHeader}>
                        <Text style={[styles.tableHeaderText, styles.colDesc]}>Description</Text>
                        <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
                        <Text style={[styles.tableHeaderText, styles.colPrice]}>Price</Text>
                        <Text style={[styles.tableHeaderText, styles.colTotal]}>Total</Text>
                    </View>

                    {/* Rows */}
                    {items.map((item: any, i: number) => (
                        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
                            <Text style={styles.colDesc}>{item.desc || 'Item'}</Text>
                            <Text style={styles.colQty}>{item.qty || 1}</Text>
                            <Text style={styles.colPrice}>{Currency(item.price || 0)}</Text>
                            <Text style={styles.colTotal}>{Currency((item.price || 0) * (item.qty || 1))}</Text>
                        </View>
                    ))}

                    {items.length === 0 && (
                        <View style={styles.tableRow}>
                            <Text style={{ color: '#999', fontStyle: 'italic' }}>No items</Text>
                        </View>
                    )}
                </View>

                {/* Totals */}
                <View style={styles.totalsSection}>
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Subtotal</Text>
                        <Text style={styles.totalValue}>{Currency(subtotal)}</Text>
                    </View>
                    {cashback > 0 && (
                        <View style={styles.totalRow}>
                            <Text style={styles.totalLabel}>Cashback/Discount</Text>
                            <Text style={[styles.totalValue, { color: '#dc2626' }]}>- {Currency(cashback)}</Text>
                        </View>
                    )}
                    <View style={[styles.totalRow, styles.grandTotalRow]}>
                        <Text style={styles.grandTotalLabel}>Grand Total</Text>
                        <Text style={styles.grandTotalValue}>{Currency(invoice.totalAmount)}</Text>
                    </View>
                </View>

                {/* Payment Terms */}
                {paymentTerms.length > 0 && (
                    <View style={styles.paymentSection}>
                        <Text style={styles.paymentTitle}>💳 Payment Schedule</Text>
                        {paymentTerms.map((term: any, i: number) => (
                            <View key={i} style={styles.paymentRow}>
                                <Text style={styles.paymentLabel}>{term.label}</Text>
                                <Text style={styles.paymentValue}>{Currency(term.amount)}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Footer */}
                <Text style={styles.footer}>
                    Thank you for your business! | Generated by InvoiceApp V2
                </Text>
            </Page>
        </Document>
    );
};
