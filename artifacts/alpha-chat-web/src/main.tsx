import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './lib/wallet-client';
import { initI18n } from './i18n';
import App from './App';
import './index.css';

const queryClient = new QueryClient();

const Root = () => (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);

initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(<Root />);
}).catch(() => {
  createRoot(document.getElementById('root')!).render(<Root />);
});
