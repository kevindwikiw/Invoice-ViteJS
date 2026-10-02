import type { PackageDefinition } from './types'

export const PACKAGES = [
  {
    id: 'wedding-coverage',
    title: 'Wedding Coverage',
    summary:
      'Seed package family for wedding photography coverage. Pricing and inclusions are intentionally pending.',
    serviceIds: ['wedding-photography'],
    priceLabel: null,
    inclusions: [],
  },
  {
    id: 'prewedding-session',
    title: 'Prewedding Session',
    summary:
      'Seed package family for prewedding sessions. Pricing and inclusions are intentionally pending.',
    serviceIds: ['prewedding-photography'],
    priceLabel: null,
    inclusions: [],
  },
  {
    id: 'sangjit-coverage',
    title: 'Sangjit Coverage',
    summary:
      'Seed package family for Sangjit coverage. Pricing and inclusions are intentionally pending.',
    serviceIds: ['sangjit-photography'],
    priceLabel: null,
    inclusions: [],
  },
  {
    id: 'wedding-film',
    title: 'Wedding Film',
    summary:
      'Seed package family for wedding videography coverage. Pricing and inclusions are intentionally pending.',
    serviceIds: ['wedding-videography'],
    priceLabel: null,
    inclusions: [],
  },
] as const satisfies readonly PackageDefinition[]
