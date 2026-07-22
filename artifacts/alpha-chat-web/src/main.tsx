import { createRoot } from 'react-dom/client';
import { initI18n } from './i18n';
import App from './App';
import './index.css';

const Root = () => <App />;

initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(<Root />);
}).catch(() => {
  createRoot(document.getElementById('root')!).render(<Root />);
});
