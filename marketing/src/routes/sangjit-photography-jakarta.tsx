import { createFileRoute } from '@tanstack/react-router'
import { ServiceLocationTemplate } from '../components/ServiceLocationTemplate'

export const Route = createFileRoute('/sangjit-photography-jakarta')({
  component: SangjitPhotographyJakartaPage,
})

function SangjitPhotographyJakartaPage() {
  return <ServiceLocationTemplate serviceId="sangjit-photography" />
}
