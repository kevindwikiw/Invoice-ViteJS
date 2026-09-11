import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'

export const Route = createFileRoute('/prewedding-bali')({
  component: PreweddingBaliPage,
})

function PreweddingBaliPage() {
  return <RoutePlaceholder title="Prewedding Bali" />
}
