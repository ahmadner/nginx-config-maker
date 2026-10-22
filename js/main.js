// Entry point. The whole app is static: no network requests, no backend.
import { App } from './ui/app.js';

const root = document.getElementById('app');

try {
  const app = new App(root);
  app.mount();
  // Exposed for debugging in the browser console only.
  window.__nginxConfigGenerator = app;
} catch (e) {
  console.error(e);
  root.textContent = '';
  const p = document.createElement('p');
  p.className = 'boot boot-error';
  p.textContent = `The app could not start: ${e && e.message ? e.message : e}`;
  root.append(p);
}
