import type { MarketingMedia } from './types'

export const getOptimizedMediaPath = (src: string) => {
  if (src.includes('/og/')) return '/media/og/the-orbit-photo-og-1200x630.jpg'
  const width = src.includes('/hero/') ? 2000 : src.includes('/services/') ? 1600 : 1200
  return src.replace(/\.jpg$/i, `-${width}.webp`)
}

const getOptimizedDimensions = (media: MarketingMedia) => {
  if (media.src.includes('/og/')) return { width: 1200, height: 630 }
  const width = media.src.includes('/hero/') ? 2000 : media.src.includes('/services/') ? 1600 : 1200
  return {
    width,
    height: Math.round((width * (media.height ?? 1)) / (media.width ?? 1)),
  }
}

const getOptimizedSrcSet = (src: string) => {
  if (src.includes('/og/')) return undefined
  const width = src.includes('/hero/') ? 2000 : src.includes('/services/') ? 1600 : 1200
  const smallWidth = width === 2000 ? 1000 : width === 1600 ? 800 : 700
  return `${src.replace(/\.jpg$/i, `-${smallWidth}.webp`)} ${smallWidth}w, ${src.replace(/\.jpg$/i, `-${width}.webp`)} ${width}w`
}

const RAW_CURATED_MEDIA = [
  {
    id: 'home-hero-bali-cliff',
    kind: 'image',
    src: '/media/hero/home-hero-bali-cliff.jpg',
    alt: 'Couple standing together on a Bali cliffside',
    purpose: ['hero', 'service', 'portfolio', 'schema'],
    serviceIds: ['prewedding-photography'],
    locationIds: ['bali'],
    portfolioStoryId: 'prewedding-bali-cliff',
    width: 6000,
    height: 4000,
  },
  {
    id: 'home-hero-veil-kiss',
    kind: 'image',
    src: '/media/hero/home-hero-veil-kiss.jpg',
    alt: 'Bride and groom kissing beneath a wedding veil',
    purpose: ['hero', 'portfolio', 'og', 'schema'],
    serviceIds: ['wedding-photography'],
    locationIds: ['jakarta', 'bali'],
    portfolioStoryId: 'wedding-veil-portraits',
    width: 4000,
    height: 6000,
  },
  {
    id: 'home-hero-yosemite-veil',
    kind: 'image',
    src: '/media/hero/home-hero-yosemite-veil.jpg',
    alt: 'Wedding couple portrait with a flowing veil in a mountain landscape',
    purpose: ['hero', 'portfolio'],
    serviceIds: ['wedding-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-veil-portraits',
    width: 6830,
    height: 4553,
  },
  {
    id: 'portfolio-wedding-veil-kiss',
    kind: 'image',
    src: '/media/portfolio/wedding-veil-kiss.jpg',
    alt: 'Bride and groom sharing a kiss under a wedding veil',
    purpose: ['portfolio', 'service'],
    serviceIds: ['wedding-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-veil-portraits',
    width: 3456,
    height: 5184,
  },
  {
    id: 'portfolio-wedding-outdoor-kiss',
    kind: 'image',
    src: '/media/portfolio/wedding-outdoor-kiss.jpg',
    alt: 'Wedding couple kissing outdoors during a portrait session',
    purpose: ['portfolio'],
    serviceIds: ['wedding-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-veil-portraits',
    width: 4016,
    height: 6016,
  },
  {
    id: 'portfolio-detail-rings-bouquet',
    kind: 'image',
    src: '/media/portfolio/detail-rings-bouquet.jpg',
    alt: 'Wedding rings styled with a bridal bouquet',
    purpose: ['portfolio'],
    serviceIds: ['wedding-photography', 'sangjit-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-detail-styling',
    width: 5304,
    height: 3538,
  },
  {
    id: 'portfolio-detail-bouquet-rings',
    kind: 'image',
    src: '/media/portfolio/detail-bouquet-rings.jpg',
    alt: 'Wedding rings placed among soft floral details',
    purpose: ['portfolio'],
    serviceIds: ['wedding-photography', 'sangjit-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-detail-styling',
    width: 6240,
    height: 4160,
  },
  {
    id: 'portfolio-detail-ring-flower',
    kind: 'image',
    src: '/media/portfolio/detail-ring-flower.jpg',
    alt: 'Close-up wedding ring detail on a flower',
    purpose: ['portfolio'],
    serviceIds: ['wedding-photography', 'sangjit-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-detail-styling',
    width: 4480,
    height: 6720,
  },
  {
    id: 'service-wedding-jakarta-veil-kiss',
    kind: 'image',
    src: '/media/services/wedding-jakarta-veil-kiss.jpg',
    alt: 'Wedding couple portrait for Jakarta wedding photography',
    purpose: ['service'],
    serviceIds: ['wedding-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-veil-portraits',
    width: 3456,
    height: 5184,
  },
  {
    id: 'service-prewedding-bali-cliff',
    kind: 'image',
    src: '/media/services/prewedding-bali-cliff.jpg',
    alt: 'Couple portrait on a Bali cliff for prewedding photography',
    purpose: ['service'],
    serviceIds: ['prewedding-photography'],
    locationIds: ['bali'],
    portfolioStoryId: 'prewedding-bali-cliff',
    width: 6000,
    height: 4000,
  },
  {
    id: 'service-sangjit-jakarta-tea-set',
    kind: 'image',
    src: '/media/services/sangjit-jakarta-tea-set.jpg',
    alt: 'Sangjit tea ceremony details arranged for a Jakarta celebration',
    purpose: ['service', 'portfolio'],
    serviceIds: ['sangjit-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'sangjit-jakarta-ceremony',
    width: 4232,
    height: 6348,
  },
  {
    id: 'service-sangjit-jakarta-red-ceremony',
    kind: 'image',
    src: '/media/services/sangjit-jakarta-red-ceremony.jpg',
    alt: 'Sangjit ceremony moment with red celebration details',
    purpose: ['service', 'portfolio'],
    serviceIds: ['sangjit-photography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'sangjit-jakarta-ceremony',
    width: 4160,
    height: 6240,
  },
  {
    id: 'service-wedding-videography-poster',
    kind: 'image',
    src: '/media/services/wedding-videography-poster.jpg',
    alt: 'Wedding film poster still for videography coverage',
    purpose: ['service', 'portfolio'],
    serviceIds: ['wedding-videography'],
    locationIds: ['jakarta'],
    portfolioStoryId: 'wedding-film-poster',
    width: 5753,
    height: 3835,
    notes:
      'Poster/still from the Drive videography folder. The 108 MB MP4 showreel source remains outside Git for phase 1.',
  },
  {
    id: 'the-orbit-photo-og',
    kind: 'image',
    src: '/media/og/the-orbit-photo-og.jpg',
    alt: 'The Orbit Photo wedding portrait preview',
    purpose: ['og', 'schema'],
    serviceIds: ['wedding-photography'],
    locationIds: ['jakarta', 'bali'],
    portfolioStoryId: 'wedding-veil-portraits',
    width: 4000,
    height: 6000,
    notes:
      'Temporary real portfolio-led OG image copied from the approved hero set. MKT-205 can crop/export a dedicated 1200x630 derivative.',
  },
  {
    id: 'the-orbit-photo-logo-og',
    kind: 'image',
    src: '/media/og/the-orbit-photo-logo.png',
    alt: 'The Orbit Photo logo',
    purpose: ['brand'],
    serviceIds: [],
    locationIds: [],
    width: 791,
    height: 296,
    notes: 'Existing public-safe brand asset copied from client/public/logo.png.',
  },
] as const satisfies readonly MarketingMedia[]

export const CURATED_MEDIA = RAW_CURATED_MEDIA.map((media) => {
  const dimensions = getOptimizedDimensions(media)
  return {
    ...media,
    src: getOptimizedMediaPath(media.src),
    ...dimensions,
    srcSet: getOptimizedSrcSet(media.src),
    sizes: media.src.includes('/hero/')
      ? '100vw'
      : '(min-width: 1024px) 33vw, 100vw',
  }
}) satisfies readonly MarketingMedia[]

export const DEFAULT_OG_IMAGE = CURATED_MEDIA.find(
  ({ id }) => id === 'the-orbit-photo-og',
) ?? CURATED_MEDIA[0]
