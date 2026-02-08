import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from './lib/query-client'

async function bootstrap() {
  if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
    const { setupPlaywrightMocks } = await import(
      './test/playwright/mock-backend'
    )
    await setupPlaywrightMocks()
  }

  const { default: App } = await import('./App')
  const root = document.getElementById('root')
  if (!root) return

  ReactDOM.createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}

void bootstrap()
