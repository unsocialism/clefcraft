import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('No #root element in index.html');

/**
 * Offline support, for the installed app. Production only: in development
 * a service worker would serve stale code from its cache and hide your
 * edits behind it.
 */
function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        // Hand the worker the files this page has already loaded, so the
        // app starts offline after the very first visit rather than the
        // second. See public/sw.js.
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .concat(location.href);
        registration.active?.postMessage({ type: 'cache-urls', urls });
      })
      .catch(() => {
        // Offline support is a bonus; the app works without it.
      });
  });
}

registerServiceWorker();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
