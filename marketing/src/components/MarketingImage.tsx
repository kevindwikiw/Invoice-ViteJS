import type { ImgHTMLAttributes } from 'react'

export type MarketingImageProps = Pick<
  ImgHTMLAttributes<HTMLImageElement>,
  | 'alt'
  | 'className'
  | 'fetchPriority'
  | 'height'
  | 'loading'
  | 'sizes'
  | 'width'
> & {
  src: string
  srcSet?: string
}

export function MarketingImage({
  alt,
  className,
  fetchPriority,
  height,
  loading = 'lazy',
  sizes,
  src,
  srcSet,
  width,
}: MarketingImageProps) {
  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      fetchPriority={fetchPriority}
      height={height}
      loading={loading}
      sizes={sizes}
      src={src}
      srcSet={srcSet}
      width={width}
    />
  )
}
