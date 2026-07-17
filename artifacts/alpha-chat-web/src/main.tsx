import { createRoot } from 'react-dom/client';
import { initI18n } from './i18n';
import App from './App';
import './index.css';

// Inizializza i18n PRIMA del primo render — elimina la race condition
// e garantisce che t() funzioni dal primo mount.
initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
}).catch(() => {
  // Fallback: renderizza comunque anche se i18n fallisce (rete offline)
  createRoot(document.getElementById('root')!).render(<App />);
});
