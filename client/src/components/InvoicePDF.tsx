import {
    Page,
    Text,
    View,
    Document,
    StyleSheet,
    Image,
    Svg,
    Path,
    Line,
    Font,
} from "@react-pdf/renderer";

import Logo from "../assets/pdf/logo.png";
import IconLoc from "../assets/pdf/Location.png";
import IconMail from "../assets/pdf/Email.png";
import IconIG from "../assets/pdf/IG.png";
import IconPhone from "../assets/pdf/Phonecall.png";

// IMPORTANT FIX: Stop weird word-splitting
Font.registerHyphenationCallback((word) => [word]);

// ======================
// Metrics / Constants
// ======================
const MM = 2.83465;
const mm = (n: number) => n * MM;

const A4_WIDTH = mm(210);
const MARGIN = mm(15);
const CONTENT_WIDTH = A4_WIDTH - 2 * MARGIN;

const TOP_BAR_H = mm(30);
const LOGO_BLOCK_W = mm(60);
const RIBBON_H = mm(14);

const FOOTER_H = mm(10);
const FOOTER_GAP = mm(6);

// Column Widths: [10mm, 96mm, 31mm, 12mm, 31mm]
const COL_WIDTHS_MM = [10, 96, 31, 12, 31] as const;
const COL_WIDTHS = COL_WIDTHS_MM.map((w) => mm(w));
const SUM_COL_WIDTHS = COL_WIDTHS[2] + COL_WIDTHS[3] + COL_WIDTHS[4];
const LEFT_INFO_W = CONTENT_WIDTH - SUM_COL_WIDTHS;

const DEFAULT_TIMEZONE = "Asia/Jakarta";

const COLORS = {
    BLACK: "#1a1a1a",
    DARK_GRAY: "#4a4a4a",
    WHITE: "#ffffff",
    RED: "#b91c1c",
    BORDER: "#000000",
} as const;

// ======================
// Types (dibikin lebih rapih)
// ======================
type BundleSrc = { desc: string; details: string };

type InvoiceItem = {
    name?: string;
    desc: string;
    details?: string;
    price: number;
    qty: number;
    isBundle: boolean;
    bundleSrc: BundleSrc[];
};

type PaymentTerm = { label: string; amount: number };

type InvoiceData = {
    items?: unknown[];
    title?: unknown;
    eventTitle?: unknown;

    hours?: unknown; // New Field

    paymentTerms?: Array<{ label?: unknown; amount?: unknown }>;

    // Legacy
    pay_term1?: unknown;
    pay_dp1?: unknown;
    pay_term2?: unknown;
    pay_term3?: unknown;
    pay_full?: unknown;

    cashback?: unknown;
    weddingDate?: unknown;
    venue?: unknown;

    bankName?: unknown;
    bankAcc?: unknown;
    bankHolder?: unknown;

    terms?: unknown;
    timeZone?: unknown;

    footerAddress?: unknown;
    footerEmail?: unknown;
    footerIG?: unknown;
    footerPhone?: unknown;
    waTemplate?: unknown;
};

type Invoice = {
    invoiceData?: unknown;
    totalAmount?: number | null;

    invoiceNo?: string | number | null;
    clientName?: string | null;
    date?: string | Date | null;
};

// ======================
// Small + Safe helpers
// ======================
const s = (v: unknown, fallback = ""): string => {
    if (typeof v === "string") {
        const t = v.trim();
        return t ? t : fallback;
    }
    if (v == null) return fallback;
    const t = String(v).trim();
    return t ? t : fallback;
};

const n = (v: unknown, fallback = 0): number => {
    if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
    if (typeof v === "string") {
        const cleaned = v.replace(/[^\d.-]/g, "").trim();
        if (!cleaned) return fallback;
        const num = Number(cleaned);
        return Number.isFinite(num) ? num : fallback;
    }
    return fallback;
};

const splitLinesSafe = (v: unknown): string[] => {
    const t = s(v, "");
    if (!t) return [];
    return t
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
};

const parseInvoiceData = (raw: unknown): InvoiceData => {
    if (!raw) return {};
    if (typeof raw === "object") return raw as InvoiceData;
    if (typeof raw === "string") {
        const t = raw.trim();
        if (!t) return {};
        try {
            const parsed = JSON.parse(t);
            return parsed && typeof parsed === "object" ? (parsed as InvoiceData) : {};
        } catch {
            return {};
        }
    }
    return {};
};

// 0 => FREE
const fmtCurrency = (val: unknown): string => {
    const num = n(val, NaN);
    if (!Number.isFinite(num) || num === 0) return "FREE";

    const abs = Math.round(Math.abs(num));
    let formatted = "";
    try {
        formatted = abs.toLocaleString("id-ID");
    } catch {
        formatted = String(abs);
    }
    return num < 0 ? `- Rp ${formatted}` : `Rp ${formatted}`;
};

// payment row: 0 => "-"
const fmtPaymentRow = (val: unknown): string => {
    const num = n(val, 0);
    if (!num) return "-";

    const abs = Math.round(Math.abs(num));
    let formatted = "";
    try {
        formatted = abs.toLocaleString("id-ID");
    } catch {
        formatted = String(abs);
    }
    return `Rp ${formatted}`;
};

const formatDateSafe = (dateLike: unknown, timeZone = DEFAULT_TIMEZONE): string => {
    let d: Date | null = null;

    if (dateLike instanceof Date) {
        d = Number.isNaN(dateLike.getTime()) ? null : dateLike;
    } else if (typeof dateLike === "string") {
        const t = dateLike.trim();
        if (!t) return "";
        const parsed = new Date(t);
        d = Number.isNaN(parsed.getTime()) ? null : parsed;
        if (!d) return t; // fallback: keep original string
    } else {
        return "";
    }

    if (!d) return "";

    try {
        return new Intl.DateTimeFormat("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone,
        }).format(d);
    } catch {
        return d.toDateString();
    }
};

const normalizeItems = (data: InvoiceData): InvoiceItem[] => {
    if (!Array.isArray(data.items)) return [];

    return data.items.map((raw: any) => {
        const isBundle = Boolean(raw?.isBundle || raw?._bundle);

        const bundleSrcRaw = Array.isArray(raw?._bundleSrc)
            ? raw._bundleSrc
            : Array.isArray(raw?._bundle_src)
                ? raw._bundle_src
                : [];

        const bundleSrc: BundleSrc[] = (bundleSrcRaw ?? []).map((b: any) => ({
            desc: s(b?.desc ?? b?.Description, ""),
            details: s(b?.details ?? b?.Details, ""),
        }));

        return {
            name: s(raw?.name ?? raw?.Name, ""),
            desc: s(raw?.desc ?? raw?.Description, ""),
            details: s(raw?.details ?? raw?.Details, ""),
            price: n(raw?.price ?? raw?.Price, 0),
            qty: Math.max(1, n(raw?.qty ?? raw?.Qty, 1)),
            isBundle,
            bundleSrc,
        };
    });
};

const normalizePaymentTerms = (data: InvoiceData): PaymentTerm[] => {
    const fromNew: PaymentTerm[] = Array.isArray(data.paymentTerms)
        ? data.paymentTerms
            .map((t) => ({
                label: s(t?.label, "Payment"),
                amount: n(t?.amount, 0),
            }))
        : [];

    if (fromNew.length) return fromNew;

    const hasLegacy = Boolean(
        data.pay_term1 || data.pay_dp1 || data.pay_term2 || data.pay_term3 || data.pay_full
    );
    if (!hasLegacy) return [];

    return [
        { label: "Down Payment", amount: n(data.pay_dp1, 0) },
        { label: "Termin 1", amount: n(data.pay_term2, 0) },
        { label: "Termin 2", amount: n(data.pay_term3, 0) },
        { label: "Pelunasan", amount: n(data.pay_full, 0) },
    ];
};

// ======================
// Robust text helpers (ANTI RUSAK)
// ======================

// allow wrap at "_" "-" "/" by inserting zero-width space




// ======================
// Styles
// ======================
const INVOICE_TOP = mm(10.5);
const INVOICE_UNDERLINE_TOP = mm(19);
const INVOICE_UNDERLINE_W = 95; // points (± 35mm)
const RIBBON_BR_Y = RIBBON_H * 0.01;

const styles = StyleSheet.create({
    page: {
        paddingTop: 0,
        paddingBottom: FOOTER_H + FOOTER_GAP,
        paddingLeft: MARGIN,
        paddingRight: MARGIN,
        fontFamily: "Helvetica",
        fontSize: 10,
        color: COLORS.BLACK,
        lineHeight: 1.2,
    },

    headerBar: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: TOP_BAR_H,
        backgroundColor: COLORS.BLACK,
    },

    headerLeftEdgeLine: {
        position: "absolute",
        left: MARGIN,
        top: 0,
        height: "100%",
        width: 0.5,
        backgroundColor: COLORS.WHITE,
    },

    headerDivider: {
        position: "absolute",
        left: MARGIN + LOGO_BLOCK_W,
        top: 0,
        height: "100%",
        width: 0.5,
        backgroundColor: COLORS.WHITE,
    },

    logoContainer: {
        position: "absolute",
        left: MARGIN + mm(4),
        top: mm(3),
        width: LOGO_BLOCK_W - mm(8),
        height: TOP_BAR_H - mm(6),
        justifyContent: "center",
        alignItems: "flex-start",
    },
    logo: {
        width: mm(52),
        height: "100%",
        objectFit: "contain",
    },

    invoiceTitle: {
        position: "absolute",
        right: MARGIN,
        top: INVOICE_TOP,
        color: COLORS.WHITE,
        fontFamily: "Times-Bold",
        fontSize: 22,
    },
    titleUnderline: {
        position: "absolute",
        right: MARGIN,
        top: INVOICE_UNDERLINE_TOP,
        width: INVOICE_UNDERLINE_W,
        height: 1,
        backgroundColor: COLORS.WHITE,
    },

    // ======================
    // Metadata (NEW GRID, SEJAJAR, RAPET KE HEADER)
    // ======================
    metaContainer: {
        marginTop: TOP_BAR_H + mm(12),
        flexDirection: "row",
        alignItems: "flex-start",
        width: CONTENT_WIDTH,
        paddingBottom: mm(2),
    },

    metaLeft: {
        flex: 50,
        paddingRight: mm(3),
        justifyContent: 'center',
    },

    metaDivider: {
        width: 1,
        backgroundColor: COLORS.BORDER,
        alignSelf: "stretch",
        marginHorizontal: 0,
    },

    metaRight: {
        flex: 50,
        paddingLeft: mm(3),
        justifyContent: 'center',
    },

    metaRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        marginBottom: mm(2),
    },

    metaKey: {
        width: mm(24),
        fontSize: 9,
        fontFamily: "Helvetica-Bold",
        color: COLORS.BLACK,
        textAlign: "right",
    },

    metaColon: {
        width: mm(3.5),
        fontSize: 9,
        fontFamily: "Helvetica-Bold",
        color: COLORS.BLACK,
        textAlign: "center",
    },

    metaVal: {
        flex: 1,
        fontSize: 9,
        fontFamily: "Helvetica",
        color: COLORS.BLACK,
    },

    metaValStrong: {
        flex: 1,
        fontSize: 11,
        fontFamily: "Helvetica-Bold",
        textTransform: "uppercase",
        lineHeight: 1.1,
    },
    metaSub: {
        flex: 1,
        fontSize: 8,
        fontFamily: "Helvetica-Oblique",
        color: COLORS.DARK_GRAY,
    },

    label: { fontSize: 8, fontFamily: "Helvetica-Bold", color: COLORS.DARK_GRAY },
    clientName: {
        fontSize: 12,
        fontFamily: "Helvetica-Bold",
        textTransform: "uppercase",
        marginBottom: 2,
        lineHeight: 1.1,
    },
    eventTitle: { fontSize: 8, fontFamily: "Helvetica-Oblique", color: COLORS.DARK_GRAY },

    table: {
        marginTop: mm(4),
        borderTopWidth: 0.5,
        borderLeftWidth: 0.5,
        borderColor: COLORS.BORDER,
    },
    row: {
        flexDirection: "row",
        borderBottomWidth: 0.5,
        borderRightWidth: 0.5,
        borderColor: COLORS.BORDER,
        alignItems: "stretch",
    },
    headerRow: { backgroundColor: COLORS.BLACK },
    cell: {
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 5,
        paddingRight: 5,
        borderRightWidth: 0.5,
        borderColor: COLORS.BORDER,
        justifyContent: "center",
    },
    cellLast: { borderRightWidth: 0 },
    headerCell: {
        color: COLORS.WHITE,
        fontSize: 8,
        fontFamily: "Helvetica-Bold",
        textAlign: "center",
    },
    c1: { width: COL_WIDTHS[0] },
    c2: { width: COL_WIDTHS[1] },
    c3: { width: COL_WIDTHS[2] },
    c4: { width: COL_WIDTHS[3] },
    c5: { width: COL_WIDTHS[4] },

    postTable: { flexDirection: "row", marginTop: 0 },
    postLeft: {
        width: LEFT_INFO_W,
        paddingRight: mm(6),
        marginTop: mm(8),
    },
    postRight: { width: SUM_COL_WIDTHS, marginTop: 0 },

    sumRow: { flexDirection: "row", alignItems: "center" },
    sumLabel: {
        width: COL_WIDTHS[2] + COL_WIDTHS[3],
        textAlign: "right",
        paddingRight: 5,
        fontSize: 8,
    },
    sumValue: { width: COL_WIDTHS[4], textAlign: "right", paddingRight: 5, fontSize: 8 },
    bgBlack: { backgroundColor: COLORS.BLACK },
    textWhite: { color: COLORS.WHITE },
    textBold: { fontFamily: "Helvetica-Bold" },
    textLg: { fontSize: 12 },
    textMed: { fontSize: 10 },
    textItalic: { fontFamily: "Helvetica-Oblique" },

    infoBlock: { marginBottom: mm(8) },
    infoHeader: {
        fontSize: 9,
        fontFamily: "Helvetica-Bold",
        borderBottomWidth: 1,
        borderBottomColor: COLORS.BLACK,
        marginBottom: 3,
        alignSelf: "flex-start",
    },
    infoRow: { flexDirection: "row", marginBottom: 2 },
    infoLabel: { width: mm(18), fontSize: 8, fontFamily: "Helvetica-Bold" },
    infoVal: { fontSize: 8, fontFamily: "Helvetica" },

    footerBar: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: FOOTER_H,
        backgroundColor: COLORS.BLACK,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 0,
        flexWrap: "nowrap",
    },
    footerItem: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 1,
    },
    footerIcon: { width: mm(2.2), height: mm(2.2), marginRight: mm(0.8), objectFit: "contain" },
    footerText: { fontSize: 6, lineHeight: 1, color: COLORS.WHITE },
});

// ======================
// Subcomponents
// ======================
// ======================
// Subcomponents
// ======================
function Header({ title = "INVOICE" }: { title?: string }) {
    return (
        <>
            <View fixed style={styles.headerBar} />
            <View fixed style={styles.headerLeftEdgeLine} />
            <View fixed style={styles.headerDivider} />

            <View fixed style={styles.logoContainer}>
                {Logo ? <Image src={Logo} style={styles.logo} /> : <Text>LOGO</Text>}
            </View>

            <Svg
                fixed
                style={{
                    position: "absolute",
                    top: TOP_BAR_H - 0.5,
                    left: MARGIN,
                    width: LOGO_BLOCK_W,
                    height: RIBBON_H,
                }}
            >
                <Path
                    d={[
                        `M 0 0`,
                        `L ${LOGO_BLOCK_W} 0`,
                        `L ${LOGO_BLOCK_W} ${RIBBON_BR_Y}`,
                        `L 0 ${RIBBON_H}`,
                        `Z`,
                    ].join(" ")}
                    fill={COLORS.BLACK}
                />
                <Line x1={0} y1={0} x2={0} y2={RIBBON_H} stroke={COLORS.WHITE} strokeWidth={1} />
                <Line
                    x1={LOGO_BLOCK_W}
                    y1={0}
                    x2={LOGO_BLOCK_W}
                    y2={RIBBON_BR_Y}
                    stroke={COLORS.WHITE}
                    strokeWidth={1}
                />
                <Line
                    x1={0}
                    y1={RIBBON_H}
                    x2={LOGO_BLOCK_W}
                    y2={RIBBON_BR_Y}
                    stroke={COLORS.WHITE}
                    strokeWidth={0.5}
                />
            </Svg>

            <Text fixed style={styles.invoiceTitle}>
                {title}
            </Text>
            <View fixed style={styles.titleUnderline} />
        </>
    );
}

type FooterProps = {
    address: string;
    email: string;
    ig: string;
    phone: string;
};

function Footer({ address, email, ig, phone }: FooterProps) {
    return (
        <View fixed style={styles.footerBar}>
            {IconLoc ? <Image src={IconLoc} style={styles.footerIcon} /> : null}
            <Text style={styles.footerText}>{address}</Text>

            <Text style={{ color: COLORS.WHITE, fontSize: 6.5, marginHorizontal: 4 }}>|</Text>

            {IconMail ? <Image src={IconMail} style={styles.footerIcon} /> : null}
            <Text style={styles.footerText}>{email}</Text>

            <Text style={{ color: COLORS.WHITE, fontSize: 6.5, marginHorizontal: 4 }}>|</Text>

            {IconIG ? <Image src={IconIG} style={styles.footerIcon} /> : null}
            <Text style={styles.footerText}>{ig}</Text>

            <Text style={{ color: COLORS.WHITE, fontSize: 6.5, marginHorizontal: 4 }}>|</Text>

            {IconPhone ? <Image src={IconPhone} style={styles.footerIcon} /> : null}
            <Text style={styles.footerText}>{phone}</Text>
        </View>
    );
}

// ======================
// Main Component
// ======================
export const InvoicePDF = ({ invoice, proofs = [] }: { invoice: Invoice; proofs?: string[] }) => {
    try {
        const data = parseInvoiceData(invoice?.invoiceData);
        // ... (rest of data parsing) ...
        const items = normalizeItems(data);
        const paymentTerms = normalizePaymentTerms(data);

        const cashback = n(data.cashback, 0);
        const subtotal = items.reduce((acc, item) => acc + item.price * item.qty, 0);

        const invoiceTotalAmount = n(invoice?.totalAmount, NaN);
        const computedGrand = subtotal - cashback;
        const grandTotal = Number.isFinite(invoiceTotalAmount) ? invoiceTotalAmount : computedGrand;

        const paidTotal = paymentTerms.reduce((acc, t) => acc + t.amount, 0);
        const remaining = Math.max(0, grandTotal - paidTotal);

        const tz = s(data.timeZone, DEFAULT_TIMEZONE);
        const weddingDate = (data.weddingDate ?? invoice?.date ?? "") as unknown;
        const dateStr = formatDateSafe(weddingDate, tz);
        const venue = s(data.venue, "");
        const hours = s(data.hours, ""); // Extract Hours

        const defaultTerms =
            "Booking fee is non-refundable.\nFull payment is required before event.\nEdit process takes 2-4 weeks.";
        const termsLines = splitLinesSafe(s(data.terms, defaultTerms));

        const clientName = s(invoice?.clientName, "");
        const invoiceNo = s(invoice?.invoiceNo, "");
        const eventTitle = s(data.eventTitle ?? data.title, "");

        // Config Extraction
        const footerAddress = s(data.footerAddress, "Jl. Panembakan Gg Sukamaju 15 No. 3, Kota Cimahi");
        const footerEmail = s(data.footerEmail, "theorbitphoto@gmail.com");
        const footerIG = s(data.footerIG, "@theorbitphoto");
        const footerPhone = s(data.footerPhone, "0813-2333-1506");

        const hasCashback = cashback > 0;
        const hasEventDetails = Boolean(dateStr || venue);

        return (
            <Document>
                <Page size="A4" style={styles.page}>
                    <Header />

                    {/* Metadata */}
                    {/* Metadata: Matches User Reference */}
                    {/* Metadata: Clean Split Design */}
                    {/* Metadata: Right Cluster Design */}
                    <View style={[styles.metaContainer, { justifyContent: 'flex-end', alignItems: 'flex-start' }]}>
                        {/* INVOICE TO (Right Aligned Cluster) */}
                        <View style={{ marginRight: 20, alignItems: 'flex-end' }}>
                            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8, color: COLORS.DARK_GRAY, textTransform: 'uppercase', marginBottom: 2, textAlign: 'right' }}>
                                INVOICE TO
                            </Text>
                            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12, textTransform: 'uppercase', marginBottom: 4, textAlign: 'right' }}>
                                {clientName}
                            </Text>
                            {eventTitle ? (
                                <Text style={{ fontFamily: 'Helvetica-Oblique', fontSize: 9, color: COLORS.DARK_GRAY, textAlign: 'right' }}>
                                    {eventTitle}
                                </Text>
                            ) : null}
                        </View>

                        {/* Invoice Details (Right Aligned Cluster) */}
                        <View style={{ alignItems: 'flex-end' }}>
                            <View style={{ flexDirection: 'row', marginBottom: 2 }}>
                                <Text style={{ fontSize: 9, fontFamily: 'Helvetica', color: COLORS.DARK_GRAY, textAlign: 'right', marginRight: 4 }}>
                                    Invoice:
                                </Text>
                                <Text style={{ fontSize: 9, fontFamily: 'Helvetica', color: COLORS.BLACK, textAlign: 'right' }}>
                                    {invoiceNo}
                                </Text>
                            </View>
                            <View style={{ flexDirection: 'row' }}>
                                <Text style={{ fontSize: 9, fontFamily: 'Helvetica', color: COLORS.DARK_GRAY, textAlign: 'right', marginRight: 4 }}>
                                    Date:
                                </Text>
                                <Text style={{ fontSize: 9, fontFamily: 'Helvetica', color: COLORS.BLACK, textAlign: 'right' }}>
                                    {dateStr}
                                </Text>
                            </View>
                            {/* Venue / Hours (Optional) */}

                        </View>
                    </View>

                    {/* Table */}
                    <View style={styles.table}>
                        <View fixed style={[styles.row, styles.headerRow]}>
                            <View style={[styles.cell, styles.c1]}>
                                <Text style={styles.headerCell}>NO</Text>
                            </View>
                            <View style={[styles.cell, styles.c2]}>
                                <Text style={styles.headerCell}>ITEM DESCRIPTION</Text>
                            </View>
                            <View style={[styles.cell, styles.c3]}>
                                <Text style={styles.headerCell}>PRICE</Text>
                            </View>
                            <View style={[styles.cell, styles.c4]}>
                                <Text style={styles.headerCell}>QTY</Text>
                            </View>
                            <View style={[styles.cell, styles.c5, styles.cellLast]}>
                                <Text style={styles.headerCell}>TOTAL</Text>
                            </View>
                        </View>

                        {items.length === 0 ? (
                            <View style={styles.row}>
                                <View style={[styles.cell, { width: CONTENT_WIDTH, borderRightWidth: 0 }]}>
                                    <Text
                                        style={{
                                            color: COLORS.DARK_GRAY,
                                            fontFamily: "Helvetica-Oblique",
                                            fontSize: 10,
                                            textAlign: "center",
                                        }}
                                    >
                                        No Items
                                    </Text>
                                </View>
                            </View>
                        ) : (
                            items.map((item, i) => {
                                const lineTotal = item.price * item.qty;

                                return (
                                    <View key={`${i}-${item.desc || "item"}`} style={styles.row} wrap={false}>
                                        <View style={[styles.cell, styles.c1]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{String(i + 1)}</Text>
                                        </View>

                                        <View style={[styles.cell, styles.c2]}>
                                            {!item.isBundle ? (
                                                <View style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                                                    {/* 1. Item Name/Title */}
                                                    <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 2 }}>
                                                        {item.name || "Item"}
                                                    </Text>

                                                    {/* 2. Item Description (if exists and different) */}
                                                    {item.desc && item.desc !== item.name ? (
                                                        <Text style={{ fontSize: 8, fontFamily: "Helvetica", color: COLORS.DARK_GRAY, marginBottom: 2 }}>
                                                            {item.desc}
                                                        </Text>
                                                    ) : null}

                                                    {/* 3. Item Details (Bullets) */}
                                                    {item.details ? (
                                                        splitLinesSafe(item.details).map((l, idx) => (
                                                            <Text key={idx} style={{ fontSize: 8, color: COLORS.DARK_GRAY, marginLeft: 4 }}>
                                                                • {l}
                                                            </Text>
                                                        ))
                                                    ) : null}
                                                </View>
                                            ) : (
                                                <View>
                                                    <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold" }}>
                                                        {item.desc || "BUNDLING"}
                                                    </Text>
                                                    {item.bundleSrc.map((sub, idx) => (
                                                        <View key={idx} style={{ marginTop: 2 }}>
                                                            <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold" }}>• {sub.desc}</Text>
                                                            {splitLinesSafe(sub.details).map((l, li) => (
                                                                <Text key={li} style={{ fontSize: 7, color: "#666666", marginLeft: 5 }}>
                                                                    - {l}
                                                                </Text>
                                                            ))}
                                                        </View>
                                                    ))}
                                                </View>
                                            )}
                                        </View>

                                        <View style={[styles.cell, styles.c3]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{fmtCurrency(item.price)}</Text>
                                        </View>

                                        <View style={[styles.cell, styles.c4]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{String(item.qty)}</Text>
                                        </View>

                                        <View style={[styles.cell, styles.c5, styles.cellLast]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{fmtCurrency(lineTotal)}</Text>
                                        </View>
                                    </View>
                                );
                            })
                        )}
                    </View>

                    {/* Post-table */}
                    <View style={styles.postTable}>
                        <View style={styles.postLeft}>
                            {hasEventDetails ? (
                                <View style={styles.infoBlock}>
                                    <Text style={styles.infoHeader}>EVENT DETAILS:</Text>

                                    {dateStr ? (
                                        <View style={styles.infoRow}>
                                            <Text style={styles.infoLabel}>Date</Text>
                                            <Text style={{ width: 10, textAlign: "center", fontSize: 8 }}>:</Text>
                                            <Text style={styles.infoVal}>{dateStr}</Text>
                                        </View>
                                    ) : null}

                                    {venue ? (
                                        <View style={styles.infoRow}>
                                            <Text style={styles.infoLabel}>Venue</Text>
                                            <Text style={{ width: 10, textAlign: "center", fontSize: 8 }}>:</Text>
                                            <Text style={[styles.infoVal, { flex: 1 }]}>{venue}</Text>
                                        </View>
                                    ) : null}
                                </View>
                            ) : null}

                            <View style={styles.infoBlock}>
                                <Text style={styles.infoHeader}>PAYMENT INFO:</Text>

                                <View style={styles.infoRow}>
                                    <Text style={styles.infoLabel}>Bank</Text>
                                    <Text style={{ width: 10, textAlign: "center", fontSize: 8 }}>:</Text>
                                    <Text style={styles.infoVal}>{s(data.bankName, "BCA")} </Text>
                                </View>

                                <View style={styles.infoRow}>
                                    <Text style={styles.infoLabel}>Account</Text>
                                    <Text style={{ width: 10, textAlign: "center", fontSize: 8 }}>:</Text>
                                    <Text style={styles.infoVal}>{s(data.bankAcc, "1392839213")}</Text>
                                </View>

                                <View style={styles.infoRow}>
                                    <Text style={styles.infoLabel}>A/N</Text>
                                    <Text style={{ width: 10, textAlign: "center", fontSize: 8 }}>:</Text>
                                    <Text style={styles.infoVal}>{s(data.bankHolder, "The Orbit Photography")}</Text>
                                </View>
                            </View>

                            {termsLines.length ? (
                                <View style={styles.infoBlock}>
                                    <Text style={styles.infoHeader}>TERMS & CONDITIONS:</Text>
                                    {termsLines.map((l, i) => (
                                        <View key={i} style={{ flexDirection: "row", marginBottom: 2 }}>
                                            <Text style={{ width: 15, fontSize: 8 }}>{String(i + 1)}.</Text>
                                            <Text style={{ flex: 1, fontSize: 8, color: COLORS.DARK_GRAY }}>{l}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                        </View>

                        <View style={styles.postRight}>
                            {hasCashback ? (
                                <>
                                    <View style={[styles.sumRow, styles.bgBlack, { paddingVertical: 6 }]}>
                                        <Text style={[styles.sumLabel, styles.textWhite, styles.textBold, styles.textMed]}>TOTAL:</Text>
                                        <Text style={[styles.sumValue, styles.textWhite, styles.textBold, styles.textMed]}>
                                            {fmtCurrency(subtotal)}
                                        </Text>
                                    </View>

                                    <View style={[styles.sumRow, { paddingVertical: 5 }]}>
                                        <Text style={[styles.sumLabel, styles.textBold, { color: COLORS.DARK_GRAY }]}>Cashback:</Text>
                                        <Text style={[styles.sumValue, styles.textBold, { color: COLORS.DARK_GRAY }]}>
                                            {cashback > 0 ? `- ${fmtPaymentRow(cashback)}` : "-"}
                                        </Text>
                                    </View>
                                </>
                            ) : null}

                            <View style={[styles.sumRow, styles.bgBlack, { paddingVertical: 8, marginBottom: 2 }]}>
                                <Text style={[styles.sumLabel, styles.textWhite, styles.textBold, styles.textLg]}>GRAND TOTAL:</Text>
                                <Text style={[styles.sumValue, styles.textWhite, styles.textBold, styles.textLg]}>
                                    {fmtCurrency(grandTotal)}
                                </Text>
                            </View>

                            {paymentTerms.length ? (
                                <View style={{ marginTop: mm(1) }}>
                                    <View style={[styles.sumRow, { paddingVertical: 1 }]}>
                                        <Text
                                            style={[
                                                styles.sumLabel,
                                                { color: COLORS.DARK_GRAY, fontSize: 8, paddingTop: mm(1), fontFamily: "Helvetica-BoldOblique" },
                                            ]}
                                        >
                                            PAYMENT HISTORY
                                        </Text>
                                    </View>

                                    {paymentTerms.map((t, i) => (
                                        <View key={`${t.label}-${i}`} style={[styles.sumRow, { paddingVertical: 1 }]}>
                                            <Text style={[styles.sumLabel, { color: COLORS.DARK_GRAY, fontSize: 7.5 }]}>{t.label}:</Text>
                                            <Text style={[styles.sumValue, { color: COLORS.DARK_GRAY, fontSize: 7.5 }]}>
                                                {t.amount > 0 ? `- ${fmtPaymentRow(t.amount)}` : "-"}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}

                            <View style={[styles.sumRow, { marginTop: 0, paddingTop: mm(1) }]}>
                                <Text style={[styles.sumLabel, { color: COLORS.RED, fontFamily: "Helvetica-Bold" }]}>
                                    SISA TAGIHAN (REMAINING):
                                </Text>
                                <Text style={[styles.sumValue, { color: COLORS.RED, fontFamily: "Helvetica-Bold" }]}>
                                    {remaining <= 0 ? "LUNAS" : fmtCurrency(remaining)}
                                </Text>
                            </View>

                            {/* Closed the postRight view */}
                        </View>
                        {/* Closed the postTable view */}
                    </View>

                    <Footer
                        address={footerAddress}
                        email={footerEmail}
                        ig={footerIG}
                        phone={footerPhone}
                    />
                </Page>

                {/* Proof Pages */}
                {proofs && proofs.length > 0 && proofs.map((proof, idx) => (
                    <Page key={`proof-${idx}`} size="A4" style={styles.page}>
                        <Header title={`PAYMENT PROOF ${idx + 1}`} />

                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 40, marginBottom: 20 }}>
                            <Image
                                src={`${window.location.origin}/uploads/proofs/${proof}`}
                                style={{
                                    width: '90%',
                                    height: '80%',
                                    objectFit: 'contain'
                                }}
                            />
                        </View>

                        <Footer
                            address={footerAddress}
                            email={footerEmail}
                            ig={footerIG}
                            phone={footerPhone}
                        />
                    </Page>
                ))}
            </Document>
        );
    } catch (e) {
        return (
            <Document>
                <Page size="A4" style={{ padding: 24 }}>
                    <Text>Error Rendering PDF: {String(e)}</Text>
                </Page>
            </Document>
        );
    }
};

export default InvoicePDF;
