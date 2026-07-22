import { createRoot } from 'react-dom/client';
import { ThirdwebProvider } from "thirdweb/react";
import { initI18n } from './i18n';
import App from './App';
import './index.css';

// Inizializza i18n PRIMA del primo render — elimina la race condition
// e garantisce che t() funzioni dal primo mount.
initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <ThirdwebProvider>
      <App />
    </ThirdwebProvider>
  );
}).catch(() => {
  createRoot(document.getElementById('root')!).render(
    <ThirdwebProvider>
      <App />
    </ThirdwebProvider>
  );
});
