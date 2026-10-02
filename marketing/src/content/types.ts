export type ServiceId =
  | 'wedding-photography'
  | 'prewedding-photography'
  | 'sangjit-photography'
  | 'wedding-videography'

export type LocationId = 'jakarta' | 'bali'

export type PackageId =
  | 'wedding-coverage'
  | 'prewedding-session'
  | 'sangjit-coverage'
  | 'wedding-film'

export type PortfolioStoryId = string
export type FaqId = string
export type TestimonialId = string
export type MarketingMediaId = string

export type MarketingMediaPurpose =
  | 'brand'
  | 'hero'
  | 'portfolio'
  | 'service'
  | 'package'
  | 'og'
  | 'schema'

export interface Location {
  readonly id: LocationId
  readonly name: string
  readonly region: string
  readonly country: string
}

export interface Service {
  readonly id: ServiceId
  readonly title: string
  readonly shortTitle: string
  readonly category: 'photography' | 'videography'
  readonly summary: string
  readonly locationIds: readonly LocationId[]
  readonly packageIds: readonly PackageId[]
  readonly portfolioStoryIds: readonly PortfolioStoryId[]
  readonly faqIds: readonly FaqId[]
  readonly testimonialIds: readonly TestimonialId[]
}

export interface PortfolioStory {
  readonly id: PortfolioStoryId
  readonly title: string
  readonly serviceIds: readonly ServiceId[]
  readonly locationIds: readonly LocationId[]
  readonly summary: string
  readonly media: readonly PortfolioMedia[]
}

export interface PortfolioMedia {
  readonly kind: 'image' | 'video'
  readonly src: string
  readonly alt: string
  readonly posterSrc?: string
}

export interface MarketingMedia {
  readonly id: MarketingMediaId
  readonly kind: 'image' | 'video'
  readonly src: string
  readonly alt: string
  readonly purpose: readonly MarketingMediaPurpose[]
  readonly serviceIds: readonly ServiceId[]
  readonly locationIds: readonly LocationId[]
  readonly portfolioStoryId?: PortfolioStoryId
  readonly width?: number
  readonly height?: number
  readonly srcSet?: string
  readonly sizes?: string
  readonly notes?: string
}

export interface PackageDefinition {
  readonly id: PackageId
  readonly title: string
  readonly summary: string
  readonly serviceIds: readonly ServiceId[]
  readonly priceLabel: string | null
  readonly inclusions: readonly string[]
}

export interface FaqItem {
  readonly id: FaqId
  readonly question: string
  readonly answer: string
  readonly serviceIds: readonly ServiceId[]
}

export interface Testimonial {
  readonly id: TestimonialId
  readonly quote: string
  readonly attribution: string
  readonly serviceIds: readonly ServiceId[]
  readonly portfolioStoryId?: PortfolioStoryId
}
