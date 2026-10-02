import { Link } from '@tanstack/react-router'
import { LANDING_CONFIG } from '../config/landing'
import {
  CURATED_MEDIA,
  FAQS,
  LOCATIONS,
  PACKAGES,
  PORTFOLIO_STORIES,
  TESTIMONIALS,
  getServiceById,
  type FaqItem,
  type Location,
  type MarketingMedia,
  type ServiceId,
  type Testimonial,
} from '../content'
import { MarketingImage } from './MarketingImage'

const mediaItems: readonly MarketingMedia[] = CURATED_MEDIA
const faqItems: readonly FaqItem[] = FAQS
const testimonialItems: readonly Testimonial[] = TESTIMONIALS

const approachCopy = {
  photography: [
    {
      title: 'Quiet Direction',
      body: 'A calm presence for portraits, details, family rhythm, and the small exchanges that should never feel over-managed.',
    },
    {
      title: 'Editorial Rhythm',
      body: 'Coverage is shaped around light, movement, setting, and sequence, so the gallery feels intentional without losing the day.',
    },
    {
      title: 'Finished To Last',
      body: 'Color and contrast stay refined, natural, and restrained, built for a gallery you can return to long after the event.',
    },
  ],
  videography: [
    {
      title: 'Scene-Led Coverage',
      body: 'The film is captured as a sequence of atmosphere, movement, sound, and emotion rather than a stack of disconnected clips.',
    },
    {
      title: 'Cinematic Pacing',
      body: 'Camera movement, framing, and edit rhythm are planned around the way the day actually unfolds.',
    },
    {
      title: 'Personal Finish',
      body: 'The final film keeps the texture of the celebration intact: voices, pauses, rooms, entrances, and the feeling between them.',
    },
  ],
} as const

function getLocations(serviceId: ServiceId): readonly Location[] {
  const service = getServiceById(serviceId)

  return service.locationIds.map((locationId) => {
    const location = LOCATIONS.find(({ id }) => id === locationId)

    if (!location) {
      throw new Error(`Missing location for service: ${service.id}`)
    }

    return location
  })
}

function getServiceMedia(serviceId: ServiceId): MarketingMedia {
  const serviceMedia = mediaItems.find(
    ({ kind, purpose, serviceIds }) =>
      kind === 'image' && purpose.includes('service') && serviceIds.includes(serviceId),
  )

  if (serviceMedia) return serviceMedia

  const portfolioMedia = mediaItems.find(
    ({ kind, purpose, serviceIds }) =>
      kind === 'image' && purpose.includes('portfolio') && serviceIds.includes(serviceId),
  )

  if (!portfolioMedia) {
    throw new Error(`Missing marketing media for service: ${serviceId}`)
  }

  return portfolioMedia
}

function getStoryMedia(src: string): MarketingMedia {
  const media = mediaItems.find((item) => item.src === src)

  if (!media) {
    throw new Error(`Missing optimized portfolio media: ${src}`)
  }

  return media
}

export function ServiceLocationTemplate({
  serviceId,
}: Readonly<{ serviceId: ServiceId }>) {
  const service = getServiceById(serviceId)
  const locations = getLocations(serviceId)
  const heroMedia = getServiceMedia(serviceId)
  const stories = PORTFOLIO_STORIES.filter(({ id }) =>
    service.portfolioStoryIds.includes(id),
  )
  const packages = PACKAGES.filter(({ id }) => service.packageIds.includes(id))
  const faqs = faqItems.filter(({ id }) => service.faqIds.includes(id))
  const testimonials = testimonialItems.filter(({ id }) =>
    service.testimonialIds.includes(id),
  )
  const inquiryHref = `mailto:${LANDING_CONFIG.contact.email}?subject=${encodeURIComponent(
    `${service.shortTitle} inquiry`,
  )}`
  const primaryLocation = locations[0]

  return (
    <main className="service-page">
      <section className="service-hero" aria-labelledby="service-title">
        <div className="service-hero__copy">
          <p className="eyebrow">
            {service.category} / {locations.map(({ name }) => name).join(' / ')}
          </p>
          <h1 id="service-title">{service.title}</h1>
          <p className="service-hero__summary">{service.summary}</p>
          <div className="service-hero__actions">
            <a className="hero-button hero-button--primary" href={inquiryHref}>
              Start the conversation <span aria-hidden="true">-&gt;</span>
            </a>
            <Link className="hero-button hero-button--secondary" to="/portfolio">
              View related work <span aria-hidden="true">-&gt;</span>
            </Link>
          </div>
        </div>

        <figure className="service-hero__media">
          <MarketingImage
            alt={heroMedia.alt}
            className="service-hero__image"
            fetchPriority="high"
            height={heroMedia.height}
            loading="eager"
            sizes="(min-width: 1024px) 48vw, 100vw"
            src={heroMedia.src}
            srcSet={heroMedia.srcSet}
            width={heroMedia.width}
          />
          <figcaption>
            <span>{primaryLocation.name}</span>
            <span>{primaryLocation.country}</span>
          </figcaption>
        </figure>
      </section>

      <section className="service-overview" aria-labelledby="service-overview-title">
        <div>
          <p className="eyebrow">Approach</p>
          <h2 id="service-overview-title">A structured eye for emotional days.</h2>
        </div>
        <div className="service-overview__grid">
          {approachCopy[service.category].map((item, index) => (
            <article className="service-process" key={item.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="service-locations" aria-labelledby="service-locations-title">
        <p className="eyebrow">Coverage area</p>
        <h2 id="service-locations-title">Built around the place, pace, and people.</h2>
        <div className="service-locations__list">
          {locations.map((location) => (
            <div className="service-location" key={location.id}>
              <span>{location.name}</span>
              <span>{location.region}</span>
              <span>{location.country}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="service-stories" aria-labelledby="service-stories-title">
        <div className="service-section-heading">
          <p className="eyebrow">Portfolio slot</p>
          <h2 id="service-stories-title">Related stories from real coverage.</h2>
        </div>
        <div className="service-stories__grid">
          {stories.map((story) => {
            const storyMedia = getStoryMedia(story.media[0].src)

            return (
              <article className="service-story" key={story.id}>
                <figure>
                  <MarketingImage
                    alt={story.media[0].alt}
                    className="service-story__image"
                    height={storyMedia.height}
                    loading="lazy"
                    sizes="(min-width: 1024px) 32vw, 100vw"
                    src={storyMedia.src}
                    srcSet={storyMedia.srcSet}
                    width={storyMedia.width}
                  />
                </figure>
                <div>
                  <h3>{story.title}</h3>
                  <p>{story.summary}</p>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="service-packages" aria-labelledby="service-packages-title">
        <div className="service-section-heading">
          <p className="eyebrow">Package slot</p>
          <h2 id="service-packages-title">Coverage shaped to the assignment.</h2>
        </div>
        <div className="service-packages__list">
          {packages.map((packageItem) => (
            <article className="service-package" key={packageItem.id}>
              <div>
                <h3>{packageItem.title}</h3>
                <p>{packageItem.summary}</p>
              </div>
              <div className="service-package__details">
                <p>{packageItem.priceLabel ?? 'Custom quote'}</p>
                <ul>
                  {(packageItem.inclusions.length > 0
                    ? packageItem.inclusions
                    : ['Coverage scope confirmed during inquiry']
                  ).map((inclusion) => (
                    <li key={inclusion}>{inclusion}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      {testimonials.length > 0 ? (
        <section className="service-testimonials" aria-labelledby="service-testimonials-title">
          <p className="eyebrow">Testimonials</p>
          <h2 id="service-testimonials-title">What clients remember.</h2>
          {testimonials.map((testimonial) => (
            <figure key={testimonial.id}>
              <blockquote>{testimonial.quote}</blockquote>
              <figcaption>{testimonial.attribution}</figcaption>
            </figure>
          ))}
        </section>
      ) : null}

      {faqs.length > 0 ? (
        <section className="service-faq" aria-labelledby="service-faq-title">
          <p className="eyebrow">FAQ</p>
          <h2 id="service-faq-title">Questions before we begin.</h2>
          <div className="service-faq__list">
            {faqs.map((faq) => (
              <article key={faq.id}>
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="service-cta" aria-labelledby="service-cta-title">
        <p className="eyebrow">Inquiry</p>
        <h2 id="service-cta-title">Tell us what the day should feel like.</h2>
        <a className="hero-button hero-button--primary" href={inquiryHref}>
          Email {LANDING_CONFIG.businessName} <span aria-hidden="true">-&gt;</span>
        </a>
      </section>
    </main>
  )
}
