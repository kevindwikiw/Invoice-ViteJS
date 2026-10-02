import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'
import { PORTFOLIO_STORIES } from '../content'

export const Route = createFileRoute('/portfolio')({
  component: PortfolioPage,
})

function PortfolioPage() {
  return (
    <RoutePlaceholder
      title="Portfolio"
      summary={`${PORTFOLIO_STORIES.length} portfolio stories are ready for curated production content.`}
    />
  )
}
