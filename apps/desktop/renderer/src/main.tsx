import { combineLifecycleFailures, runLifecycleOperations } from '@memorilo/effect-lifecycle'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import {
  bootstrapRenderer,
} from './app/bootstrap-renderer'
import {
  DesktopConfigurationEnvironment,
} from './app/configuration/configuration-environment'
import { router } from './app/router'
import { NotePersistenceManager } from './features/notes/persistence/note-persistence-manager'
import { NotePersistenceProvider } from './features/notes/persistence/note-persistence-provider'
import { desktopRequests } from './shared/desktop-requests'
import { errorMessage } from './shared/error-message'
import './styles/renderer-global.stylex'
import './styles/renderer-stylex.css'

const rootElement = document.querySelector('#root')

if (!rootElement)
  throw new Error('Missing renderer root element')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

const root = createRoot(rootElement)

void bootstrapRenderer(
  async (store) => {
    const notePersistenceManager = new NotePersistenceManager({ adapter: desktopRequests })
    const dispose = () => runLifecycleOperations([
      () => root.unmount(),
      () => notePersistenceManager.close(),
      () => queryClient.clear(),
    ], 'Renderer application shutdown failed')
    try {
      root.render(
        <StrictMode>
          <DesktopConfigurationEnvironment store={store}>
            <QueryClientProvider client={queryClient}>
              <NotePersistenceProvider manager={notePersistenceManager}>
                <RouterProvider router={router} />
              </NotePersistenceProvider>
            </QueryClientProvider>
          </DesktopConfigurationEnvironment>
        </StrictMode>,
      )
    }
    catch (error) {
      try {
        await dispose()
      }
      catch (cleanupError) {
        throw combineLifecycleFailures(
          [error, cleanupError],
          'Renderer application mount and cleanup failed',
        )
      }
      throw error
    }
    return dispose
  },
  error => root.render(<main role="alert">{errorMessage(error)}</main>),
)
