import type { Service, ServiceId } from './types'

export const SERVICES = [
  {
    id: 'wedding-photography',
    title: 'Wedding Photographer Jakarta',
    shortTitle: 'Wedding Photography',
    category: 'photography',
    summary:
      'Minimal seed content for the Jakarta wedding photography route. Final production copy will be added in the page/content tickets.',
    locationIds: ['jakarta'],
    packageIds: ['wedding-coverage'],
    portfolioStoryIds: ['wedding-veil-portraits', 'wedding-detail-styling'],
    faqIds: [],
    testimonialIds: [],
  },
  {
    id: 'prewedding-photography',
    title: 'Prewedding Bali',
    shortTitle: 'Prewedding Photography',
    category: 'photography',
    summary:
      'Minimal seed content for the Bali prewedding route. Final production copy will be added in the page/content tickets.',
    locationIds: ['bali'],
    packageIds: ['prewedding-session'],
    portfolioStoryIds: ['prewedding-bali-cliff'],
    faqIds: [],
    testimonialIds: [],
  },
  {
    id: 'sangjit-photography',
    title: 'Sangjit Photography Jakarta',
    shortTitle: 'Sangjit Photography',
    category: 'photography',
    summary:
      'Minimal seed content for the Jakarta Sangjit photography route. Final production copy will be added in the page/content tickets.',
    locationIds: ['jakarta'],
    packageIds: ['sangjit-coverage'],
    portfolioStoryIds: ['sangjit-jakarta-ceremony', 'wedding-detail-styling'],
    faqIds: [],
    testimonialIds: [],
  },
  {
    id: 'wedding-videography',
    title: 'Wedding Videographer Jakarta',
    shortTitle: 'Wedding Videography',
    category: 'videography',
    summary:
      'Minimal seed content for the Jakarta wedding videography route. Final production copy will be added in the page/content tickets.',
    locationIds: ['jakarta'],
    packageIds: ['wedding-film'],
    portfolioStoryIds: ['wedding-film-poster'],
    faqIds: [],
    testimonialIds: [],
  },
] as const satisfies readonly Service[]

export function getServiceById(serviceId: ServiceId): Service {
  const service = SERVICES.find(({ id }) => id === serviceId)

  if (!service) {
    throw new Error(`Unknown marketing service: ${serviceId}`)
  }

  return service
}
