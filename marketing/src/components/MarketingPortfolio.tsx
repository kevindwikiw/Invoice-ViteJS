import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CURATED_MEDIA, PORTFOLIO_STORIES } from '../content'
import { MarketingImage } from './MarketingImage'
import { PortfolioLightbox, type PortfolioLightboxItem } from './PortfolioLightbox'

const tiles = [
  { storyId: 'wedding-veil-portraits', mediaIndex: 0, className: 'portfolio-tile--feature' },
  { storyId: 'prewedding-bali-cliff', mediaIndex: 0, className: 'portfolio-tile--prewedding' },
  { storyId: 'sangjit-jakarta-ceremony', mediaIndex: 1, className: 'portfolio-tile--sangjit' },
  { storyId: 'wedding-detail-styling', mediaIndex: 0, className: 'portfolio-tile--details' },
  { storyId: 'wedding-film-poster', mediaIndex: 0, className: 'portfolio-tile--film' },
] as const

function getTileData(tile: (typeof tiles)[number]) {
  const story = PORTFOLIO_STORIES.find(({ id }) => id === tile.storyId)
  const media = story?.media[tile.mediaIndex]

  if (!story || !media) {
    throw new Error(`Portfolio tile is not configured: ${tile.storyId}`)
  }

  const asset = CURATED_MEDIA.find(({ src }) => src === media.src)

  if (!asset) {
    throw new Error(`Portfolio media is not mapped: ${media.src}`)
  }

  return { story, media, asset }
}

const portfolioItems = tiles.map((tile) => {
  const { asset, media, story } = getTileData(tile)

  return {
    id: `${tile.storyId}-${tile.mediaIndex}`,
    title: story.title,
    src: asset.src,
    srcSet: asset.srcSet,
    sizes: asset.sizes,
    alt: media.alt,
    width: asset.width,
    height: asset.height,
  } satisfies PortfolioLightboxItem
})

export function MarketingPortfolio() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const triggerRefs = useRef<Record<number, HTMLButtonElement | null>>({})

  const closeLightbox = () => {
    const triggerIndex = selectedIndex
    const trigger = triggerIndex === null ? null : triggerRefs.current[triggerIndex]
    setSelectedIndex(null)

    trigger?.focus()
  }

  return (
    <>
      <section className="portfolio-section" aria-labelledby="portfolio-title">
      <div className="portfolio-section__intro">
        <p className="eyebrow">Selected work</p>
        <div>
          <h2 id="portfolio-title">A feeling, held in frame.</h2>
          <p className="portfolio-section__summary">
            Real moments from weddings, preweddings, ceremonies, and films.
          </p>
        </div>
        <Link className="portfolio-section__link" to="/portfolio">
          Explore the portfolio <span aria-hidden="true">↗</span>
        </Link>
      </div>

      <div className="portfolio-grid">
        {tiles.map((tile, index) => {
          const { media, story } = getTileData(tile)

          return (
            <button
              key={portfolioItems[index].id}
              type="button"
              className={`portfolio-tile ${tile.className}`}
              aria-label={`View ${story.title} in the portfolio`}
              ref={(element) => {
                triggerRefs.current[index] = element
              }}
              onClick={() => setSelectedIndex(index)}
            >
              <figure>
                <MarketingImage
                  alt={media.alt}
                  className="portfolio-tile__image"
                  height={portfolioItems[index].height}
                  loading="lazy"
                  sizes={portfolioItems[index].sizes}
                  src={portfolioItems[index].src}
                  srcSet={portfolioItems[index].srcSet}
                  width={portfolioItems[index].width}
                />
                <figcaption>
                  <span>{story.title}</span>
                  <span aria-hidden="true">↗</span>
                </figcaption>
              </figure>
            </button>
          )
        })}
      </div>
      </section>
      <PortfolioLightbox
        items={portfolioItems}
        selectedIndex={selectedIndex}
        onChange={setSelectedIndex}
        onClose={closeLightbox}
      />
    </>
  )
}
