import { createFileRoute } from '@tanstack/react-router'
import { ServiceLocationTemplate } from '../components/ServiceLocationTemplate'

export const Route = createFileRoute('/prewedding-bali')({
  component: PreweddingBaliPage,
})

function PreweddingBaliPage() {
  return <ServiceLocationTemplate serviceId="prewedding-photography" />
}
