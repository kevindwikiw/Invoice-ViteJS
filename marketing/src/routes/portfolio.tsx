import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'

export const Route = createFileRoute('/portfolio')({
  component: PortfolioPage,
})

function PortfolioPage() {
  return <RoutePlaceholder title="Portfolio" />
}
