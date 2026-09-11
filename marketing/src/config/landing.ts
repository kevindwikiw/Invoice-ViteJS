const trimValue = (value: string | undefined) => value?.trim() || undefined

const marketingUrl =
  trimValue(import.meta.env.PUBLIC_MARKETING_URL) || 'https://theorbitphoto.com'
const appUrl =
  trimValue(import.meta.env.PUBLIC_APP_URL) || 'https://app.theorbitphoto.com'
const businessName = 'The Orbit Photo'
const instagramUrl = 'https://www.instagram.com/theorbitphoto/'

export const LANDING_CONFIG = {
  businessName,
  urls: {
    marketing: marketingUrl,
    app: appUrl,
  },
  contact: {
    email: 'theorbitphoto@gmail.com',
    phone: null,
    whatsapp: null,
    address: null,
  },
  social: {
    instagram: instagramUrl,
    facebook: null,
    youtube: null,
    tiktok: null,
  },
  og: {
    type: 'website',
    title: businessName,
    description: null,
    image: null,
  },
  schema: {
    context: 'https://schema.org',
    type: 'PhotographyBusiness',
    image: null,
    sameAs: [instagramUrl],
  },
} as const
