import { App } from './core/App.js';

const app = new App(document.getElementById('app'), document.getElementById('ui'));
window.__app = app;
app.start().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;left:16px;top:16px;color:#f66;background:#000a;padding:12px;z-index:99;max-width:90vw;white-space:pre-wrap;pointer-events:auto';
  el.textContent = 'Ошибка запуска: ' + (err && err.stack || err);
  document.body.appendChild(el);
});
