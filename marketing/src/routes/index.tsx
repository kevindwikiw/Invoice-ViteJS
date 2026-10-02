import { createFileRoute } from '@tanstack/react-router'
import { MarketingHero } from '../components/MarketingHero'
import { MarketingPortfolio } from '../components/MarketingPortfolio'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main>
      <MarketingHero />
      <MarketingPortfolio />
    </main>
  )
}
