import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'

export const Route = createFileRoute('/wedding-videographer-jakarta')({
  component: WeddingVideographerJakartaPage,
})

function WeddingVideographerJakartaPage() {
  return <RoutePlaceholder title="Wedding Videographer Jakarta" />
}
