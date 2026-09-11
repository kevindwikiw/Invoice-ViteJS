import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'

export const Route = createFileRoute('/wedding-photographer-jakarta')({
  component: WeddingPhotographerJakartaPage,
})

function WeddingPhotographerJakartaPage() {
  return <RoutePlaceholder title="Wedding Photographer Jakarta" />
}
