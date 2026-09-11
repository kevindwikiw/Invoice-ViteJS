import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'

export const Route = createFileRoute('/sangjit-photography-jakarta')({
  component: SangjitPhotographyJakartaPage,
})

function SangjitPhotographyJakartaPage() {
  return <RoutePlaceholder title="Sangjit Photography Jakarta" />
}
