import { createRoot } from 'react-dom/client';
import { initI18n } from './i18n';
import { Providers } from './providers';
import App from './App';
import './index.css';

// Redirect investor subdomain to the Investor Book
if (window.location.hostname === 'investors.alphachat.sbs') {
  window.location.replace('/investor-book/en');
}

const Root = () => (
  <Providers>
    <App />
  </Providers>
);

initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(<Root />);
}).catch(() => {
  createRoot(document.getElementById('root')!).render(<Root />);
});
