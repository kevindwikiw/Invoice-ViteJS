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
import { parsePackageBundleDescription } from "../lib/packageCatalog";
import { shouldUseDenseInvoiceLayout } from "../lib/invoicePdfDensity";

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
    DETAIL: "#5f5f5f",
    LEGAL: "#686868",
    WHITE: "#ffffff",
    RED: "#b91c1c",
    BORDER: "#000000",
} as const;

// ======================
// Types (dibikin lebih rapih)
// ======================
type BundleSrc = { desc: string; details: string };
type RawRecord = Record<string, unknown>;

const asRecord = (value: unknown): RawRecord => (
    typeof value === 'object' && value !== null ? value as RawRecord : {}
);

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
    payment_terms?: Array<{ label?: unknown; amount?: unknown }>;

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
    notes?: unknown;
};

type Invoice = {
    invoiceData?: unknown;
    totalAmount?: number | null;

    invoiceNo?: string | number | null;
    clientName?: string | null;
    date?: string | Date | null;
    createdAt?: string | Date | null;
    created_at?: string | Date | null;
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

const splitTermsSafe = (value: unknown): string[] => {
    const text = s(value, "");
    if (!text) return [];

    return text
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+(?=\d+[.)]\s+)/g, "\n")
        .split("\n")
        .map((line) => line.trim().replace(/^\d+[.)]\s*/, ""))
        .filter(Boolean);
};

type InvoiceLayoutMetrics = {
    cellPadding: number;
    itemTitleFont: number;
    itemDescriptionFont: number;
    sectionTitleFont: number;
    detailFont: number;
    detailLineHeight: number;
    postMarginMm: number;
    infoHeaderFont: number;
    infoFont: number;
    termsFont: number;
    legalLineHeight: number;
};

const invoiceLayoutMetrics = (useDenseLayout: boolean): InvoiceLayoutMetrics => {
    if (useDenseLayout) {
        return {
            cellPadding: 6,
            itemTitleFont: 8.5,
            itemDescriptionFont: 7.25,
            sectionTitleFont: 7.25,
            detailFont: 6.25,
            detailLineHeight: 1.18,
            postMarginMm: 4.5,
            infoHeaderFont: 7.25,
            infoFont: 6.5,
            termsFont: 5.75,
            legalLineHeight: 1.16,
        };
    }

    return {
        cellPadding: 8,
        itemTitleFont: 9.25,
        itemDescriptionFont: 7.75,
        sectionTitleFont: 7.75,
        detailFont: 7,
        detailLineHeight: 1.22,
        postMarginMm: 5,
        infoHeaderFont: 8,
        infoFont: 7,
        termsFont: 6.5,
        legalLineHeight: 1.2,
    };
};

const formatHoursWithDuration = (hoursStr: string): string => {
    if (!hoursStr) return "";
    const parts = hoursStr.split("-").map((p) => p.trim());
    if (parts.length !== 2) return hoursStr;

    const parseTime = (t: string) => {
        // Handle both 15.00 and 15:00
        const [h, m] = t.replace(".", ":").split(":").map(Number);
        return isNaN(h) || isNaN(m) ? null : h * 60 + m;
    };

    const start = parseTime(parts[0]);
    const end = parseTime(parts[1]);

    if (start === null || end === null) return hoursStr;

    let diff = end - start;
    if (diff < 0) diff += 24 * 60; // Overnight

    const h = Math.floor(diff / 60);
    const m = diff % 60;

    let duration = "";
    if (h > 0) duration += `${h} Hour${h > 1 ? "s" : ""}`;
    if (m > 0) duration += (duration ? " " : "") + `${m} Min${m > 1 ? "s" : ""}`;

    return duration ? `${hoursStr} (${duration})` : hoursStr;
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

    return data.items.map((rawValue) => {
        const raw = asRecord(rawValue);
        const details = s(
            raw?.details
            ?? raw?.Details
            ?? raw?.packageDetails
            ?? raw?.package_details
            ?? raw?.description,
            "",
        );
        const parsedBundle = parsePackageBundleDescription(details);

        const bundleSrcRaw = Array.isArray(raw._bundleSrc)
            ? raw._bundleSrc
            : Array.isArray(raw._bundle_src)
                ? raw._bundle_src
                : [];

        const storedBundleSrc: BundleSrc[] = (bundleSrcRaw ?? []).map((bundleValue) => {
            const bundle = asRecord(bundleValue);
            return {
                desc: s(bundle.desc ?? bundle.Description ?? bundle.title, ""),
                details: s(bundle.details ?? bundle.Details ?? bundle.description, ""),
            };
        });
        const bundleSrc = storedBundleSrc.length > 0
            ? storedBundleSrc
            : parsedBundle.map((section) => ({ desc: section.title, details: section.details }));
        const isBundle = Boolean(raw.isBundle || raw._bundle || bundleSrc.length > 0);

        return {
            name: s(raw?.name ?? raw?.Name ?? raw?.packageName ?? raw?.package_name, ""),
            desc: s(raw?.desc ?? raw?.Description ?? raw?.name ?? raw?.Name, ""),
            details,
            price: n(raw?.price ?? raw?.Price, 0),
            qty: Math.max(1, n(raw?.qty ?? raw?.Qty, 1)),
            isBundle,
            bundleSrc,
        };
    });
};

const normalizePaymentTerms = (data: InvoiceData): PaymentTerm[] => {
    const rawPaymentTerms = Array.isArray(data.paymentTerms)
        ? data.paymentTerms
        : Array.isArray(data.payment_terms)
            ? data.payment_terms
            : [];

    const fromNew: PaymentTerm[] = rawPaymentTerms.length
        ? rawPaymentTerms
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
const TITLE_UNDERLINE_TOP = mm(19.5);
const INVOICE_UNDERLINE_W = 95;
const PROOF_UNDERLINE_W = 188;
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
    proofPage: {
        height: mm(297),
        minHeight: mm(297),
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
        top: TITLE_UNDERLINE_TOP,
        height: 1,
        backgroundColor: COLORS.WHITE,
    },

    // ======================
    // Metadata (NEW GRID, SEJAJAR, RAPET KE HEADER)
    // ======================
    metaContainer: {
        marginTop: TOP_BAR_H + mm(4),
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
        letterSpacing: 0.15,
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
        marginTop: mm(5),
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

    infoBlock: { marginBottom: mm(2.5) },
    infoHeader: {
        fontSize: 8,
        fontFamily: "Helvetica-Bold",
        letterSpacing: 0.1,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.BLACK,
        marginBottom: 2,
        alignSelf: "flex-start",
    },
    infoRow: { flexDirection: "row", marginBottom: 1 },
    infoLabel: { width: mm(18), fontSize: 7, fontFamily: "Helvetica-Bold" },
    infoColon: { width: 10, textAlign: "center", fontSize: 7 },
    infoVal: { fontSize: 7, fontFamily: "Helvetica" },

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

    proofContent: {
        position: "absolute",
        top: TOP_BAR_H + RIBBON_H + mm(4),
        bottom: FOOTER_H + mm(4),
        left: MARGIN,
        right: MARGIN,
    },
    proofMetaRow: {
        minHeight: mm(14),
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 0.75,
        borderBottomColor: COLORS.BLACK,
        paddingBottom: mm(3),
        marginBottom: mm(4),
    },
    proofMetaCell: {
        flexGrow: 1,
        paddingRight: mm(4),
    },
    proofMetaCellLast: {
        width: mm(35),
        flexGrow: 0,
        paddingRight: 0,
        alignItems: "flex-end",
    },
    proofMetaLabel: {
        fontSize: 6.5,
        fontFamily: "Helvetica-Bold",
        color: COLORS.DARK_GRAY,
        marginBottom: 2,
    },
    proofMetaValue: {
        fontSize: 9,
        fontFamily: "Helvetica-Bold",
        color: COLORS.BLACK,
    },
    proofFrame: {
        flexGrow: 1,
        minHeight: 0,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 0.75,
        borderColor: "#d4d4d4",
        backgroundColor: "#f7f7f7",
        padding: mm(5),
    },
    proofImage: {
        width: "100%",
        height: "100%",
        objectFit: "contain",
    },
    proofCaptionRow: {
        height: mm(8),
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
    },
    proofCaption: {
        fontSize: 6.5,
        fontFamily: "Helvetica-Bold",
        color: COLORS.DARK_GRAY,
    },
    proofFallbackTitle: {
        fontSize: 16,
        fontWeight: 700,
        color: COLORS.BLACK,
        marginBottom: mm(3),
        textAlign: "center",
    },
    proofFallbackText: {
        fontSize: 9,
        color: COLORS.DARK_GRAY,
        lineHeight: 1.4,
        textAlign: "center",
    },
});

// ======================
// Subcomponents
// ======================
function isRenderableProofImage(source: string): boolean {
    return /^data:image\/(?:png|jpe?g);/i.test(source);
}

function Header({ title = "INVOICE", underlineWidth = INVOICE_UNDERLINE_W }: { title?: string; underlineWidth?: number }) {
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
            <View fixed style={[styles.titleUnderline, { width: underlineWidth }]} />
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
        const layout = invoiceLayoutMetrics(shouldUseDenseInvoiceLayout(items));
        const paymentTerms = normalizePaymentTerms(data);
        const displayPaymentTerms = paymentTerms.length
            ? paymentTerms
            : [
                { label: "Down Payment", amount: 0 },
                { label: "Pelunasan", amount: 0 },
            ];

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
        const createdDate = invoice?.createdAt ?? invoice?.created_at ?? invoice?.date ?? weddingDate;
        const createdDateStr = formatDateSafe(createdDate, tz);
        const venue = s(data.venue, "");
        const hours = s(data.hours, ""); 
        const notes = s(data.notes, ""); 

        const defaultTerms =
            "Booking fee is non-refundable.\nFull payment is required before event.\nEdit process takes 2-4 weeks.";
        const termsLines = splitTermsSafe(s(data.terms, defaultTerms));

        const clientName = s(invoice?.clientName, "");
        const invoiceNo = s(invoice?.invoiceNo, "");
        const eventTitle = s(data.eventTitle ?? data.title, "");

        // Config Extraction
        const footerAddress = s(data.footerAddress, "Jl. Panembakan Gg Sukamaju 15 No. 3, Kota Cimahi");
        const footerEmail = s(data.footerEmail, "theorbitphoto@gmail.com");
        const footerIG = s(data.footerIG, "@theorbitphoto");
        const footerPhone = s(data.footerPhone, "0813-2333-1506");

        const hasCashback = cashback > 0;
        const hasEventDetails = Boolean(dateStr || venue || hours);

        return (
            <Document>
                <Page size="A4" style={styles.page}>
                    <Header />

                    <View style={[styles.metaContainer, { marginTop: TOP_BAR_H + mm(6), justifyContent: 'flex-end', alignItems: 'flex-start' }]}>
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
                            <View style={{ flexDirection: 'row', marginBottom: 2 }}>
                                <Text style={{ fontSize: 9, fontFamily: 'Helvetica', color: COLORS.DARK_GRAY, textAlign: 'right', marginRight: 4 }}>
                                    Created:
                                </Text>
                                <Text style={{ fontSize: 9, fontFamily: 'Helvetica', color: COLORS.BLACK, textAlign: 'right' }}>
                                    {createdDateStr}
                                </Text>
                            </View>
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
                                        <View style={[styles.cell, styles.c1, { paddingTop: layout.cellPadding, paddingBottom: layout.cellPadding }]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{String(i + 1)}</Text>
                                        </View>

                                        <View style={[styles.cell, styles.c2, { paddingTop: layout.cellPadding, paddingBottom: layout.cellPadding }]}>
                                            {!item.isBundle ? (
                                                <View style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                                                    <Text style={{ fontSize: layout.itemTitleFont, fontFamily: "Helvetica-Bold", marginBottom: layout.cellPadding >= 8 ? 3 : 2, lineHeight: 1.12 }}>
                                                        {item.name || "Item"}
                                                    </Text>

                                                    {item.desc && item.desc !== item.name ? (
                                                        <Text style={{ fontSize: layout.itemDescriptionFont, fontFamily: "Helvetica", color: COLORS.DARK_GRAY, marginBottom: layout.cellPadding >= 8 ? 3 : 2, lineHeight: 1.18 }}>
                                                            {item.desc}
                                                        </Text>
                                                    ) : null}

                                                    {item.details ? (
                                                        splitLinesSafe(item.details).map((line, detailIndex) => (
                                                            <Text key={detailIndex} style={{ fontSize: layout.detailFont, color: COLORS.DETAIL, marginLeft: 6, lineHeight: layout.detailLineHeight }}>
                                                                {`\u2022 ${line}`}
                                                            </Text>
                                                        ))
                                                    ) : null}
                                                </View>
                                            ) : (
                                                <View>
                                                    <Text style={{ fontSize: layout.itemTitleFont, fontFamily: "Helvetica-Bold", lineHeight: 1.12 }}>
                                                        {item.desc || "BUNDLING"}
                                                    </Text>
                                                    {item.bundleSrc.map((sub, sectionIndex) => (
                                                        <View key={sectionIndex} style={{ marginTop: layout.cellPadding >= 8 ? 3 : 2 }}>
                                                            <Text style={{ fontSize: layout.sectionTitleFont, fontFamily: "Helvetica-Bold", lineHeight: 1.15 }}>
                                                                {`\u2022 ${sub.desc}`}
                                                            </Text>
                                                            {splitLinesSafe(sub.details).map((line, detailIndex) => (
                                                                <Text key={detailIndex} style={{ fontSize: layout.detailFont, color: COLORS.DETAIL, marginLeft: 7, lineHeight: layout.detailLineHeight }}>
                                                                    {`- ${line}`}
                                                                </Text>
                                                            ))}
                                                        </View>
                                                    ))}
                                                </View>
                                            )}
                                        </View>

                                        <View style={[styles.cell, styles.c3, { paddingTop: layout.cellPadding, paddingBottom: layout.cellPadding }]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{fmtCurrency(item.price)}</Text>
                                        </View>

                                        <View style={[styles.cell, styles.c4, { paddingTop: layout.cellPadding, paddingBottom: layout.cellPadding }]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{String(item.qty)}</Text>
                                        </View>

                                        <View style={[styles.cell, styles.c5, styles.cellLast, { paddingTop: layout.cellPadding, paddingBottom: layout.cellPadding }]}>
                                            <Text style={{ fontSize: 8, textAlign: "center" }}>{fmtCurrency(lineTotal)}</Text>
                                        </View>
                                    </View>
                                );
                            })
                        )}
                    </View>

                    {/* Post-table */}
                    <View style={styles.postTable} wrap={false}>
                        <View style={[styles.postLeft, { marginTop: mm(layout.postMarginMm) }]}>
                            {hasEventDetails ? (
                                <View style={[styles.infoBlock, { marginBottom: mm(Math.max(1, layout.postMarginMm / 2)) }]}>
                                    <Text style={[styles.infoHeader, { fontSize: layout.infoHeaderFont }]}>EVENT DETAILS:</Text>

                                    {dateStr ? (
                                        <View style={styles.infoRow}>
                                            <Text style={[styles.infoLabel, { fontSize: layout.infoFont }]}>Date</Text>
                                            <Text style={[styles.infoColon, { fontSize: layout.infoFont }]}>:</Text>
                                            <Text style={[styles.infoVal, { fontSize: layout.infoFont }]}>{dateStr}</Text>
                                        </View>
                                    ) : null}

                                    {venue ? (
                                        <View style={styles.infoRow}>
                                            <Text style={[styles.infoLabel, { fontSize: layout.infoFont }]}>Venue</Text>
                                            <Text style={[styles.infoColon, { fontSize: layout.infoFont }]}>:</Text>
                                            <Text style={[styles.infoVal, { flex: 1, fontSize: layout.infoFont }]}>{venue}</Text>
                                        </View>
                                    ) : null}

                                    {hours ? (
                                        <View style={styles.infoRow}>
                                            <Text style={[styles.infoLabel, { fontSize: layout.infoFont }]}>Time</Text>
                                            <Text style={[styles.infoColon, { fontSize: layout.infoFont }]}>:</Text>
                                            <Text style={[styles.infoVal, { fontSize: layout.infoFont }]}>{formatHoursWithDuration(hours)}</Text>
                                        </View>
                                    ) : null}
                                </View>
                            ) : null}

                            <View style={[styles.infoBlock, { marginBottom: mm(Math.max(1, layout.postMarginMm / 2)) }]}>
                                <Text style={[styles.infoHeader, { fontSize: layout.infoHeaderFont }]}>PAYMENT INFO:</Text>

                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoLabel, { fontSize: layout.infoFont }]}>Bank</Text>
                                    <Text style={[styles.infoColon, { fontSize: layout.infoFont }]}>:</Text>
                                    <Text style={[styles.infoVal, { fontSize: layout.infoFont }]}>{s(data.bankName, "BCA")} </Text>
                                </View>

                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoLabel, { fontSize: layout.infoFont }]}>Account</Text>
                                    <Text style={[styles.infoColon, { fontSize: layout.infoFont }]}>:</Text>
                                    <Text style={[styles.infoVal, { fontSize: layout.infoFont }]}>{s(data.bankAcc, "1392839213")}</Text>
                                </View>

                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoLabel, { fontSize: layout.infoFont }]}>A/N</Text>
                                    <Text style={[styles.infoColon, { fontSize: layout.infoFont }]}>:</Text>
                                    <Text style={[styles.infoVal, { fontSize: layout.infoFont }]}>{s(data.bankHolder, "The Orbit Photography")}</Text>
                                </View>
                            </View>

                            {termsLines.length ? (
                                <View style={[styles.infoBlock, { marginBottom: 0 }]}>
                                    <Text style={[styles.infoHeader, { fontSize: layout.infoHeaderFont }]}>TERMS & CONDITIONS:</Text>
                                    {termsLines.map((line, index) => (
                                        <View key={index} style={{ flexDirection: "row", marginBottom: layout.cellPadding > 3 ? 0.75 : 0.35 }}>
                                            <Text style={{ width: 10, fontSize: layout.termsFont }}>{`${index + 1}.`}</Text>
                                            <Text style={{ flex: 1, fontSize: layout.termsFont, color: COLORS.LEGAL, lineHeight: layout.legalLineHeight }}>
                                                {line}
                                            </Text>
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
                                        <Text style={[styles.sumLabel, styles.textBold, { color: COLORS.DARK_GRAY, fontSize: layout.infoFont }]}>Cashback:</Text>
                                        <Text style={[styles.sumValue, styles.textBold, { color: COLORS.DARK_GRAY, fontSize: layout.infoFont }]}>
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

                            <View style={{ marginTop: mm(1) }}>
                                <View style={[styles.sumRow, { paddingVertical: 1 }]}>
                                    <Text
                                        style={[
                                            styles.sumLabel,
                                            { color: COLORS.DARK_GRAY, fontSize: layout.infoHeaderFont, paddingTop: mm(1), fontFamily: "Helvetica-BoldOblique" },
                                        ]}
                                    >
                                        PAYMENT HISTORY
                                    </Text>
                                </View>

                                {displayPaymentTerms.map((t, i) => (
                                    <View key={`${t.label}-${i}`} style={[styles.sumRow, { paddingVertical: 1 }]}>
                                        <Text style={[styles.sumLabel, { color: COLORS.DARK_GRAY, fontSize: layout.infoFont }]}>{t.label}:</Text>
                                        <Text style={[styles.sumValue, { color: COLORS.DARK_GRAY, fontSize: layout.infoFont }]}>
                                            {t.amount > 0 ? `- ${fmtPaymentRow(t.amount)}` : "-"}
                                        </Text>
                                    </View>
                                ))}
                            </View>

                            <View style={[styles.sumRow, { marginTop: 0, paddingTop: mm(1) }]}>
                                <Text style={[styles.sumLabel, { color: COLORS.RED, fontFamily: "Helvetica-Bold", fontSize: layout.infoFont }]}>
                                    SISA TAGIHAN (REMAINING):
                                </Text>
                                <Text style={[styles.sumValue, { color: COLORS.RED, fontFamily: "Helvetica-Bold", fontSize: layout.infoFont }]}>
                                    {remaining <= 0 ? "LUNAS" : fmtCurrency(remaining)}
                                </Text>
                            </View>

                            {notes ? (
                                <View style={{ marginTop: mm(Math.max(1.5, layout.postMarginMm * 0.6)) }}>
                                    <Text style={[styles.infoHeader, { fontSize: layout.infoHeaderFont, marginBottom: 2 }]}>NOTES:</Text>
                                    <Text style={{ fontSize: layout.termsFont, color: COLORS.LEGAL, lineHeight: layout.legalLineHeight }}>
                                        {notes}
                                    </Text>
                                </View>
                            ) : null}

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
                {proofs && proofs.length > 0 && proofs.map((proof, idx) => {
                    // Protected proof files are resolved to data/blob URLs by
                    // the caller before PDF rendering. Never request an
                    // anonymous upload URL from inside react-pdf.
                    const imageSrc = proof;
                    const canRenderImage = isRenderableProofImage(imageSrc);
                    const attachmentNumber = String(idx + 1).padStart(2, "0");
                    const attachmentTotal = String(proofs.length).padStart(2, "0");

                    return (
                        <Page key={`proof-${idx}`} size="A4" style={[styles.page, styles.proofPage]} wrap={false}>
                            <Header title="PAYMENT PROOF" underlineWidth={PROOF_UNDERLINE_W} />

                            <View style={styles.proofContent}>
                                <View style={styles.proofMetaRow}>
                                    <View style={styles.proofMetaCell}>
                                        <Text style={styles.proofMetaLabel}>INVOICE</Text>
                                        <Text style={styles.proofMetaValue}>{invoiceNo || "-"}</Text>
                                    </View>
                                    <View style={styles.proofMetaCell}>
                                        <Text style={styles.proofMetaLabel}>CLIENT</Text>
                                        <Text style={styles.proofMetaValue}>{clientName || "-"}</Text>
                                    </View>
                                    <View style={[styles.proofMetaCell, styles.proofMetaCellLast]}>
                                        <Text style={styles.proofMetaLabel}>ATTACHMENT</Text>
                                        <Text style={styles.proofMetaValue}>{attachmentNumber} / {attachmentTotal}</Text>
                                    </View>
                                </View>

                                <View style={styles.proofFrame}>
                                    {canRenderImage ? (
                                        <Image src={imageSrc} style={styles.proofImage} />
                                    ) : (
                                        <View>
                                            <Text style={styles.proofFallbackTitle}>PREVIEW UNAVAILABLE</Text>
                                            <Text style={styles.proofFallbackText}>
                                                This payment proof is attached to the invoice, but its file format cannot be embedded in the PDF preview.
                                            </Text>
                                        </View>
                                    )}
                                </View>

                                <View style={styles.proofCaptionRow}>
                                    <Text style={styles.proofCaption}>PAYMENT EVIDENCE</Text>
                                    <Text style={styles.proofCaption}>THE ORBIT PHOTO</Text>
                                </View>
                            </View>

                            <Footer
                                address={footerAddress}
                                email={footerEmail}
                                ig={footerIG}
                                phone={footerPhone}
                            />
                        </Page>
                    );
                })}
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
