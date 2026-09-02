import { createFileRoute } from '@tanstack/react-router'
import PlatformOnly from '../components/AppShell/PlatformOnly'
import BlueprintsPage from '../BlueprintsPage'
import { useDocumentTitle } from '../useDocumentTitle'

export const Route = createFileRoute('/explore')({
  component: () => <PlatformOnly><ExplorePage /></PlatformOnly>,
})

function ExplorePage() {
  useDocumentTitle('Explore')

  return <BlueprintsPage />
}
