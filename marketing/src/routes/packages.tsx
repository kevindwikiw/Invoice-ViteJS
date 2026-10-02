import { createFileRoute } from '@tanstack/react-router'
import { RoutePlaceholder } from '../components/RoutePlaceholder'
import { PACKAGES } from '../content'

export const Route = createFileRoute('/packages')({
  component: PackagesPage,
})

function PackagesPage() {
  return (
    <RoutePlaceholder
      title="Packages"
      summary={`${PACKAGES.length} package families are defined for future production package content.`}
    />
  )
}
