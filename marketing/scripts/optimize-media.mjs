import { mkdir, readdir } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import sharp from 'sharp'

const marketingRoot = join(import.meta.dirname, '..')
const sourceRoot = join(marketingRoot, '.media-source')
const publicRoot = join(marketingRoot, 'public', 'media')
const profiles = {
  hero: { widths: [1000, 2000], quality: 78 },
  portfolio: { widths: [700, 1200], quality: 78 },
  services: { widths: [800, 1600], quality: 78 },
}

async function optimizeDirectory(directory) {
  const sourceDirectory = join(sourceRoot, directory)
  const outputDirectory = join(publicRoot, directory)
  const files = (await readdir(sourceDirectory)).filter((file) =>
    /\.(jpe?g|png)$/i.test(file),
  )
  await mkdir(outputDirectory, { recursive: true })

  for (const file of files) {
    const sourcePath = join(sourceDirectory, file)
    const stem = basename(file, extname(file))
    for (const width of profiles[directory].widths) {
      await sharp(sourcePath)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: profiles[directory].quality, effort: 4 })
        .toFile(join(outputDirectory, `${stem}-${width}.webp`))
    }
  }
}

async function createOgImage() {
  const sourcePath = join(sourceRoot, 'hero', 'home-hero-veil-kiss.jpg')
  const outputDirectory = join(publicRoot, 'og')
  await mkdir(outputDirectory, { recursive: true })
  await sharp(sourcePath)
    .resize({ width: 1200, height: 630, fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toFile(join(outputDirectory, 'the-orbit-photo-og-1200x630.jpg'))
}

await Promise.all([
  optimizeDirectory('hero'),
  optimizeDirectory('portfolio'),
  optimizeDirectory('services'),
  createOgImage(),
])

console.log(
  `Optimized media from ${relative(marketingRoot, sourceRoot)} into ${relative(marketingRoot, publicRoot)}`,
)
