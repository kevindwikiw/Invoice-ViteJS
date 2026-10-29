export interface InvoiceItem {
    id: string;
    name?: string;
    desc: string;
    details?: string;
    price: number;
    qty: number;
    isBundle?: boolean;
    _rowId?: string;
    _bundleSrc?: InvoiceItem[];
}

export interface PaymentTerm {
    id: string;
    label: string;
    amount: number;
    locked: boolean;
}

export interface PackageData {
    id: number;
    name: string;
    price: number;
    description: string;
    category: string;
    prices?: PackagePrice[];
}

export interface PackagePrice {
    city: string;
    year: number;
    price: number;
}

export type CatalogPackage = PackageData & { catalogPrice: number | null; catalogPriceLabel: string };
