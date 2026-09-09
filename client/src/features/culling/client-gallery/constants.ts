import type { CSSProperties } from 'react';
import type { DiscountRule } from '../culling.types';

export const GALLERY_PAGE_SIZE = 50;

export const DEFAULT_ADDON_DISCOUNT_RULES: DiscountRule[] = [
    { minCount: 20, discountPercent: 20 },
    { minCount: 10, discountPercent: 10 },
];

export const idrFormat = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
});

export const BLACK_THEME = {
    '--bg-deep': '#050505',
    '--bg-card': '#0d0d0d',
    '--bg-elevated': '#171717',
    '--bg-hover': '#242424',
    '--text-primary': '#ffffff',
    '--text-secondary': '#e5e5e5',
    '--text-muted': '#999999',
    '--border': '#2a2a2a',
    '--accent': '#ffffff',
    '--accent-muted': 'rgba(255, 255, 255, 0.12)',
} as CSSProperties;

export const WHITE_THEME = {
    '--bg-deep': '#f7f7f5',
    '--bg-card': '#ffffff',
    '--bg-elevated': '#eeeeeb',
    '--bg-hover': '#e5e5e1',
    '--text-primary': '#111111',
    '--text-secondary': '#444444',
    '--text-muted': '#777777',
    '--border': '#d8d8d3',
    '--accent': '#111111',
    '--accent-muted': 'rgba(17, 17, 17, 0.10)',
} as CSSProperties;

