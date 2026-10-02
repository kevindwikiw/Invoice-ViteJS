import { Link } from '@tanstack/react-router'
import { LANDING_CONFIG } from '../config/landing'
import { CURATED_MEDIA } from '../content'
import { MarketingImage } from './MarketingImage'

function getHeroMedia() {
  const media = CURATED_MEDIA.find(({ id }) => id === 'home-hero-veil-kiss')

  if (!media) {
    throw new Error('The primary marketing hero media is not configured')
  }

  return media
}

const heroMedia = getHeroMedia()

export function MarketingHero() {
  return (
    <section className="marketing-hero" aria-labelledby="hero-title">
      <div className="marketing-hero__media">
        <MarketingImage
          alt={heroMedia.alt}
          className="marketing-hero__image"
          fetchPriority="high"
          height={heroMedia.height}
          loading="eager"
          sizes="100vw"
          src={heroMedia.src}
          srcSet={heroMedia.srcSet}
          width={heroMedia.width}
        />
        <div className="marketing-hero__veil" aria-hidden="true" />
      </div>

      <div className="marketing-hero__topline">
        <span className="marketing-hero__topline-item">
          <span className="marketing-hero__topline-index">01</span>
          <span>Selected frame</span>
        </span>
        <span className="marketing-hero__topline-item">Jakarta / Bali / beyond</span>
      </div>

      <div className="marketing-hero__content">
        <div className="marketing-hero__copy">
          <p className="marketing-hero__eyebrow">The Orbit Photo / Wedding photo + film</p>
          <h1 id="hero-title">
            <span>The day,</span>
            <span>as it felt.</span>
          </h1>
          <p className="marketing-hero__summary">
            Wedding photographs and films with a quiet eye for the moments between.
          </p>
          <div className="marketing-hero__actions">
            <a className="hero-button hero-button--primary" href={`mailto:${LANDING_CONFIG.contact.email}`}>
              Plan your story <span aria-hidden="true">↗</span>
            </a>
            <Link className="hero-button hero-button--secondary" to="/portfolio">
              See selected work <span aria-hidden="true">↓</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="marketing-hero__footer">
        <span>Photography / Videography</span>
        <span className="marketing-hero__scroll" aria-hidden="true">
          Scroll to explore <span>↓</span>
        </span>
      </div>
    </section>
  )
}
