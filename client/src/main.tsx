import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// Self-hosted so the app never contacts Google Fonts (privacy, and a stricter CSP)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import 'react-grid-layout/css/styles.css';
import './index.css';
import { initTheme } from './utils/applyTheme';
import { restoreOfflineCopy, startOfflineCopy } from './offline/snapshot';
import { loadOutbox } from './offline/outbox';

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

// Load this device's offline copy and waiting transactions first, so the app opens with
// data even when the server can't be reached (both give up quickly if storage is slow)
const withinMs = (p: Promise<unknown>, ms: number) =>
  Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
void Promise.all([restoreOfflineCopy(queryClient), withinMs(loadOutbox(), 1_500)]).finally(() => {
  startOfflineCopy(queryClient);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
});
