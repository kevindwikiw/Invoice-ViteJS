const trimValue = (value: string | undefined) => value?.trim() || undefined

const marketingUrl =
  trimValue(import.meta.env.PUBLIC_MARKETING_URL) || 'https://theorbitphoto.com'
const appUrl =
  trimValue(import.meta.env.PUBLIC_APP_URL) || 'https://app.theorbitphoto.com'
const businessName = 'The Orbit Photo'
const instagramUrl = 'https://www.instagram.com/theorbitphoto/'
const defaultOgImage = '/media/og/the-orbit-photo-og-1200x630.jpg'

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
  media: {
    showreelUrl: null,
  },
  og: {
    type: 'website',
    title: businessName,
    description: null,
    image: defaultOgImage,
  },
  schema: {
    context: 'https://schema.org',
    type: 'PhotographyBusiness',
    image: defaultOgImage,
    sameAs: [instagramUrl],
  },
} as const
