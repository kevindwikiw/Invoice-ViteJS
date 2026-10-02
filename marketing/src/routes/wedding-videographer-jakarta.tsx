import { createFileRoute } from '@tanstack/react-router'
import { ServiceLocationTemplate } from '../components/ServiceLocationTemplate'

export const Route = createFileRoute('/wedding-videographer-jakarta')({
  component: WeddingVideographerJakartaPage,
})

function WeddingVideographerJakartaPage() {
  return <ServiceLocationTemplate serviceId="wedding-videography" />
}
