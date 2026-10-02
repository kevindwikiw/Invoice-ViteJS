import type { PortfolioStory } from './types'
import { getOptimizedMediaPath } from './media'

export const PORTFOLIO_STORIES = [
  {
    id: 'wedding-veil-portraits',
    title: 'Wedding veil portraits',
    serviceIds: ['wedding-photography'],
    locationIds: ['jakarta', 'bali'],
    summary:
      'Curated real wedding portrait imagery for the phase-1 marketing site.',
    media: [
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/portfolio/wedding-veil-kiss.jpg'),
        alt: 'Bride and groom sharing a kiss under a wedding veil',
      },
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/portfolio/wedding-outdoor-kiss.jpg'),
        alt: 'Wedding couple kissing outdoors during a portrait session',
      },
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/hero/home-hero-veil-kiss.jpg'),
        alt: 'Bride and groom kissing beneath a wedding veil',
      },
    ],
  },
  {
    id: 'wedding-detail-styling',
    title: 'Wedding detail styling',
    serviceIds: ['wedding-photography', 'sangjit-photography'],
    locationIds: ['jakarta'],
    summary:
      'Curated ring, floral, and detail images for the phase-1 marketing site.',
    media: [
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/portfolio/detail-rings-bouquet.jpg'),
        alt: 'Wedding rings styled with a bridal bouquet',
      },
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/portfolio/detail-bouquet-rings.jpg'),
        alt: 'Wedding rings placed among soft floral details',
      },
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/portfolio/detail-ring-flower.jpg'),
        alt: 'Close-up wedding ring detail on a flower',
      },
    ],
  },
  {
    id: 'prewedding-bali-cliff',
    title: 'Prewedding cliff portraits',
    serviceIds: ['prewedding-photography'],
    locationIds: ['bali'],
    summary:
      'Curated Bali prewedding imagery for the phase-1 marketing site.',
    media: [
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/services/prewedding-bali-cliff.jpg'),
        alt: 'Couple portrait on a Bali cliff for prewedding photography',
      },
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/hero/home-hero-bali-cliff.jpg'),
        alt: 'Couple standing together on a Bali cliffside',
      },
    ],
  },
  {
    id: 'sangjit-jakarta-ceremony',
    title: 'Sangjit ceremony details',
    serviceIds: ['sangjit-photography'],
    locationIds: ['jakarta'],
    summary:
      'Curated Sangjit ceremony imagery for the phase-1 marketing site.',
    media: [
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/services/sangjit-jakarta-tea-set.jpg'),
        alt: 'Sangjit tea ceremony details arranged for a Jakarta celebration',
      },
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/services/sangjit-jakarta-red-ceremony.jpg'),
        alt: 'Sangjit ceremony moment with red celebration details',
      },
    ],
  },
  {
    id: 'wedding-film-poster',
    title: 'Wedding film poster',
    serviceIds: ['wedding-videography'],
    locationIds: ['jakarta'],
    summary:
      'Curated poster still for future wedding videography marketing sections.',
    media: [
      {
        kind: 'image',
        src: getOptimizedMediaPath('/media/services/wedding-videography-poster.jpg'),
        alt: 'Wedding film poster still for videography coverage',
      },
    ],
  },
] as const satisfies readonly PortfolioStory[]
