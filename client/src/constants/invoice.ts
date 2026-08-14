export const CATEGORIES = [
    "Wedding",
    "Bundling Package",
    "Prewedding",
    "Engagement/Sangjit",
    "Corporate/Event",
    "Add-ons",
    "Free / Complimentary"
];

export const PACKAGE_FILTER_TABS = ["All Categories", ...CATEGORIES];

export const CATEGORY_LABELS: Record<string, string> = {
    "Wedding": "Wedding",
    "Bundling Package": "Bundles",
    "Prewedding": "Pre-Wedding",
    "Engagement/Sangjit": "Engagement",
    "Corporate/Event": "Corporate",
    "Add-ons": "Add-ons",
    "Free / Complimentary": "Complimentary"
};

export const ITEMS_PER_PAGE = 6;
export const PAYMENT_STEP = 200000;

export const PANEL_CARD_CLASS = 'bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6';
export const PANEL_TITLE_CLASS = 'text-2xl font-semibold text-[var(--text-primary)] tracking-tight';
export const FORM_LABEL_CLASS = 'block label-xs text-[var(--text-muted)]';
