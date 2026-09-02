import type { ReactNode } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useAuthenticatedApi } from '../../AuthContext'

/**
 * The platform's own surfaces (workspaces, blueprints, outputs, explore, gatekeeper apps) stay
 * under the hood for a practitioner, whose day is matters. Admins keep them, reached from
 * The firm → Platform. Anyone else lands on their matters.
 */
export default function PlatformOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuthenticatedApi()
  if (!isAdmin) return <Navigate to="/matters" replace />
  return <>{children}</>
}
