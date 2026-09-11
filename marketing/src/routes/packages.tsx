import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'

export const Route = createFileRoute('/packages')({
  component: PackagesPage,
})

function PackagesPage() {
  return <RoutePlaceholder title="Packages" />
}
