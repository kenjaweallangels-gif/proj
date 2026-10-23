// ZERO ECHO · Echo Runtime v0.1 — browser app entry (docs/SPEC.md §8). Boots the WASM core (inlined), the agent host
// and the UI; then starts the WebGPU renderer, or the 2D compatibility map when WebGPU is unavailable.
// URL: ?dev=1 shows the mock executor and the adversarial suite (development and tests only).
import { AgentHost } from './agent/host.ts';
import { App } from './ui/app.ts';
import { h } from './ui/dom.ts';

declare global {
  interface Window {
    /** Automation hooks for web/test/e2e.mjs (read-only use). */
    __echo?: { host: AgentHost; app: App; readonly mode: string; readonly simStarted: boolean };
  }
}

async function boot(): Promise<void> {
  // The published artifact variant drops <html> attributes: set the document language here.
  document.documentElement.lang = 'ru';
  const params = new URLSearchParams(location.search);
  const dev = params.get('dev') === '1';
  let host: AgentHost;
  try {
    host = await AgentHost.create({ dev });
  } catch (e) {
    const root = document.getElementById('app') ?? document.body;
    root.replaceChildren(h('div', { class: 'notice bad fatal', role: 'alert' },
      h('span', { class: 'notice-text', text: `Не удалось запустить ядро Echo (WebAssembly): ${String((e as Error)?.message ?? e)}` })));
    console.error(e);
    return;
  }
  const app = new App(host, { dev });
  app.mount();
  window.__echo = {
    host, app,
    get mode() { return app.rendererMode(); },
    get simStarted() { return host.isStarted; },
  };
  await app.startRenderer();
}

void boot();
