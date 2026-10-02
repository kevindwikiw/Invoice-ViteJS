import { createFileRoute } from '@tanstack/react-router'
import { ServiceLocationTemplate } from '../components/ServiceLocationTemplate'

export const Route = createFileRoute('/wedding-photographer-jakarta')({
  component: WeddingPhotographerJakartaPage,
})

function WeddingPhotographerJakartaPage() {
  return <ServiceLocationTemplate serviceId="wedding-photography" />
}
