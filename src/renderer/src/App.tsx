import { useEffect } from 'react'
import { AppShell } from './app/AppShell'
import { StoreProvider, useStore } from './app/store'

function DevRoutes(): null {
  const { actions } = useStore()
  useEffect(() => {
    if (import.meta.env.DEV && location.search.includes('kit')) actions.go('kit')
  }, [actions])
  return null
}

export function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <DevRoutes />
      <AppShell />
    </StoreProvider>
  )
}
