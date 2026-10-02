import { useEffect, useRef } from 'react'
import { MarketingImage } from './MarketingImage'

export interface PortfolioLightboxItem {
  readonly id: string
  readonly title: string
  readonly src: string
  readonly srcSet?: string
  readonly sizes?: string
  readonly alt: string
  readonly width?: number
  readonly height?: number
}

interface PortfolioLightboxProps {
  readonly items: readonly PortfolioLightboxItem[]
  readonly selectedIndex: number | null
  readonly onChange: (index: number) => void
  readonly onClose: () => void
}

export function PortfolioLightbox({
  items,
  selectedIndex,
  onChange,
  onClose,
}: PortfolioLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const selectedItem = selectedIndex === null ? undefined : items[selectedIndex]

  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) return

    if (selectedItem && !dialog.open) {
      dialog.showModal()
      closeButtonRef.current?.focus()
    }

    if (!selectedItem && dialog.open) {
      dialog.close()
    }
  }, [selectedItem])

  if (!selectedItem || selectedIndex === null) {
    return <dialog ref={dialogRef} aria-label="Portfolio image viewer" />
  }

  const previousIndex = (selectedIndex - 1 + items.length) % items.length
  const nextIndex = (selectedIndex + 1) % items.length

  const close = () => {
    dialogRef.current?.close()
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="portfolio-lightbox"
      aria-labelledby="portfolio-lightbox-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onChange(previousIndex)
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onChange(nextIndex)
        }
      }}
    >
      <div className="portfolio-lightbox__inner">
        <div className="portfolio-lightbox__topbar">
          <p id="portfolio-lightbox-title">{selectedItem.title}</p>
          <button
            ref={closeButtonRef}
            type="button"
            className="portfolio-lightbox__close"
            aria-label="Close portfolio viewer"
            onClick={close}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="portfolio-lightbox__stage">
          <button
            type="button"
            className="portfolio-lightbox__control portfolio-lightbox__control--previous"
            aria-label="Previous portfolio image"
            onClick={() => onChange(previousIndex)}
          >
            <span aria-hidden="true">&larr;</span>
          </button>
          <MarketingImage
            alt={selectedItem.alt}
            className="portfolio-lightbox__image"
            height={selectedItem.height}
            loading="eager"
            sizes={selectedItem.sizes || '100vw'}
            src={selectedItem.src}
            srcSet={selectedItem.srcSet}
            width={selectedItem.width}
          />
          <button
            type="button"
            className="portfolio-lightbox__control portfolio-lightbox__control--next"
            aria-label="Next portfolio image"
            onClick={() => onChange(nextIndex)}
          >
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>

        <div className="portfolio-lightbox__bottombar">
          <span>{selectedItem.alt}</span>
          <span>{String(selectedIndex + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
        </div>
      </div>
    </dialog>
  )
}
