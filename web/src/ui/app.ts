// App shell: top bar, notices, 3D viewport with HUD (or the 2D compatibility map), side panel with tabs; wires the
// renderer (web/src/render via createRenderer only) and the agent host together.
import type {
  AdapterSummary, CameraMode, FrameSample, QualityProfile, Renderer, RendererStatus, RendererUnavailable, RouteOptions,
} from '../contracts.ts';
import { createRenderer } from '../render/index.ts';
import type { AgentHost, AiMode, SimSpeed } from '../agent/host.ts';
import type { PrivacyProfile, ProviderId } from '../agent/providers/types.ts';
import { labelOf, profiles, scene } from '../core/data.ts';
import type { AppApi, RouteRunState, Tab, TabId } from './context.ts';
import { byId, clock, h, ms, num, patch } from './dom.ts';
import { PROVIDER_STATE_RU } from './labels.ts';
import { ColonyMap } from './map2d.ts';
import { loadPrefs, savePrefs } from './prefs.ts';
import { AboutTab } from './tabs/about.ts';
import { AuthorityTab } from './tabs/authority.ts';
import { BudgetsTab } from './tabs/budgets.ts';
import { CrewTab } from './tabs/crew.ts';
import { DialogueTab } from './tabs/dialogue.ts';
import { JournalTab } from './tabs/journal.ts';
import { MemoryTab } from './tabs/memory.ts';
import { MetricsTab } from './tabs/metrics.ts';
import { QueueTab } from './tabs/queue.ts';
import { WorldTab } from './tabs/world.ts';

const UI_TICK_MS = 250;
const WORLD_PUSH_MS = 200;
const SUBTITLE_MS = 7000;
const PHASE_RU: Record<RendererStatus['phase'], string> = {
  probing: 'Проверка WebGPU', compiling: 'Компиляция шейдеров', baking: 'Подготовка сцены', ready: 'Готово',
  lost: 'Устройство WebGPU потеряно', recovering: 'Восстановление устройства', error: 'Ошибка рендера', paused: 'Пауза',
};

function isUnavailable(e: unknown): e is RendererUnavailable {
  return typeof e === 'object' && e !== null && (e as { kind?: string }).kind === 'renderer-unavailable';
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export class App implements AppApi {
  readonly host: AgentHost;
  readonly dev: boolean;
  selectedNpc = 'mira';
  readonly route: RouteRunState = { running: false, progress: '', report: null, error: null };

  private readonly tabs: Tab[];
  private readonly panels = new Map<TabId, HTMLElement>();
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private activeTab: TabId = 'crew';
  private profileCur: QualityProfile;
  private rendererObj: Renderer | null = null;
  private adapterInfo: AdapterSummary | null = null;
  private mode: 'loading' | '3d' | 'compat' = 'loading';
  private status: RendererStatus = { phase: 'probing' };
  private map: ColonyMap | null = null;
  private cameraMode: CameraMode = 'orbit';
  private lastWorldPush = 0;
  private everReady = false;
  private noticeSeq = 0;

  constructor(host: AgentHost, opts: { dev: boolean }) {
    this.host = host;
    this.dev = opts.dev;
    const prefs = loadPrefs();
    this.profileCur = profiles.quality_profiles.find((p) => p.id === prefs.profile)
      ?? profiles.quality_profiles.find((p) => p.id === 'W60') ?? profiles.quality_profiles[0];
    this.tabs = [
      new CrewTab(this), new DialogueTab(this), new AuthorityTab(this), new WorldTab(this), new JournalTab(this),
      new MemoryTab(this), new QueueTab(this), new MetricsTab(this), new BudgetsTab(this), new AboutTab(this),
    ];
    if (prefs.tab && this.tabs.some((t) => t.id === prefs.tab)) this.activeTab = prefs.tab as TabId;
    if (prefs.theme === 'dark' || prefs.theme === 'light') document.documentElement.setAttribute('data-theme', prefs.theme);
    const provider = prefs.provider as ProviderId | undefined;
    if (provider && provider in host.providers && (provider !== 'mock' || this.dev)) {
      if (provider === 'claude' || provider === 'gateway') host.setPrivacy('hybrid');
      if (provider === 'claude') host.setDeadlineScale(4);
      host.setProvider(provider);
    }
  }

  // ------------------------------------------------------------------ AppApi
  selectNpc(id: string, opts: { openDialogue?: boolean; focusCamera?: boolean } = {}): void {
    this.selectedNpc = id;
    if (opts.openDialogue) this.openTab('dialogue');
    if (opts.focusCamera && this.rendererObj) this.rendererObj.focusActor(id);
    this.refresh();
  }

  openTab(id: TabId): void {
    if (id !== this.activeTab) byId('tabpanel').scrollTop = 0;
    this.activeTab = id;
    savePrefs({ tab: id });
    for (const [tid, b] of this.tabButtons) {
      b.setAttribute('aria-selected', String(tid === id));
      b.tabIndex = tid === id ? 0 : -1;
    }
    for (const [tid, p] of this.panels) p.hidden = tid !== id;
    this.refresh();
  }

  renderer(): Renderer | null { return this.rendererObj; }
  adapter(): AdapterSummary | null { return this.adapterInfo; }
  rendererMode(): 'loading' | '3d' | 'compat' { return this.mode; }
  profile(): QualityProfile { return this.profileCur; }

  refresh(): void {
    this.renderActive();
  }

  notice(text: string, tone: 'info' | 'warn' | 'bad' = 'info'): void {
    const box = byId('notices');
    const close = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', id: `notice-close-${++this.noticeSeq}`, 'aria-label': 'Скрыть уведомление', text: 'Скрыть' });
    const n = h('div', { class: `notice ${tone}` }, h('span', { class: 'notice-text', text }), close);
    close.addEventListener('click', () => n.remove());
    box.appendChild(n);
    while (box.children.length > 3) box.firstElementChild?.remove();
    window.setTimeout(() => n.remove(), tone === 'bad' ? 15000 : 9000);
  }

  // ------------------------------------------------------------------ mount
  mount(): void {
    this.mountTopBar();
    this.mountTabs();
    this.mountViewport();
    this.host.onChange(() => { /* rendering is paced by the UI timer */ });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.setInterval(() => this.uiTick(), UI_TICK_MS);
    this.uiTick();
    this.openTab(this.activeTab);
  }

  private mountTopBar(): void {
    const profileSel = byId<HTMLSelectElement>('sel-profile');
    for (const p of profiles.quality_profiles) {
      profileSel.appendChild(h('option', { value: p.id, text: `${p.label_ru}${p.platform === 'native' ? ' (нативный)' : ''}` }));
    }
    profileSel.value = this.profileCur.id;
    profileSel.addEventListener('change', () => void this.setProfile(profileSel.value));

    const modeSel = byId<HTMLSelectElement>('sel-ai-mode');
    for (const m of profiles.ai_modes) modeSel.appendChild(h('option', { value: m.id, text: m.label_ru }));
    modeSel.value = this.host.aiMode;
    modeSel.addEventListener('change', () => this.host.setAiMode(modeSel.value as AiMode));

    const provSel = byId<HTMLSelectElement>('sel-provider');
    const ids: ProviderId[] = ['rules', 'claude', 'gateway', 'webllm', ...(this.dev ? ['mock' as const] : [])];
    for (const id of ids) provSel.appendChild(h('option', { value: id, id: `opt-provider-${id}`, text: this.host.providers[id].label }));
    provSel.value = this.host.providerId;
    provSel.addEventListener('change', () => this.setProvider(provSel.value as ProviderId));

    const privSel = byId<HTMLSelectElement>('sel-privacy');
    privSel.value = this.host.privacy;
    privSel.addEventListener('change', () => {
      this.host.setPrivacy(privSel.value as PrivacyProfile);
      if (privSel.value === 'offline' && this.host.provider.backend('offline') === 'remote') {
        this.notice('Профиль offline: удалённые исполнители не вызываются, отвечают правила.', 'info');
      }
      this.refresh();
    });

    const deadlineSel = byId<HTMLSelectElement>('sel-deadline');
    deadlineSel.value = String(this.host.deadlineScale);
    deadlineSel.addEventListener('change', () => this.host.setDeadlineScale(Number(deadlineSel.value)));

    const speed = (s: SimSpeed) => {
      this.host.setSpeed(s);
      byId('btn-speed-1').setAttribute('aria-pressed', String(s === 1));
      byId('btn-speed-4').setAttribute('aria-pressed', String(s === 4));
    };
    byId('btn-speed-1').addEventListener('click', () => speed(1));
    byId('btn-speed-4').addEventListener('click', () => speed(4));
    byId('btn-pause').addEventListener('click', () => {
      this.host.setPaused(!this.host.paused);
      this.uiTick();
    });
    byId('btn-theme').addEventListener('click', () => this.toggleTheme());
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { this.map?.readPalette(); this.updateThemeButton(); });
    this.updateThemeButton();
    byId('btn-start-now').addEventListener('click', () => { this.host.start(); this.uiTick(); });
  }

  private setProvider(id: ProviderId): void {
    const host = this.host;
    if (id === 'claude' && host.privacy === 'offline') {
      host.setPrivacy('hybrid');
      byId<HTMLSelectElement>('sel-privacy').value = 'hybrid';
      this.notice('Профиль приватности переключён на hybrid: реплики Алекса и контекст NPC будут уходить в Claude через страницу-хост. Вернуть offline — в селекторе «Приватность».', 'warn');
    }
    if (id === 'claude' && host.deadlineScale === 1) {
      host.setDeadlineScale(4);
      byId<HTMLSelectElement>('sel-deadline').value = '4';
      this.notice('Срок ответа ИИ увеличен до 10 с: удалённой модели (и первому запросу разрешения у зрителя) 2,5 с обычно мало. Это режим демонстрации API; цель документа — 2,5 с, вернуть её можно в «Срок ответа ИИ».', 'info');
    }
    host.setProvider(id);
    savePrefs({ provider: id });
    const st = host.provider.state();
    if (st.state === 'unavailable') this.notice(`${host.provider.label}: ${st.message}. Пока отвечает обычный игровой ИИ.`, 'warn');
    if (id === 'webllm' && st.state === 'off') {
      this.notice('WebLLM выключен до явного согласия на загрузку — см. вкладку «Очередь ИИ». До тех пор отвечают правила.', 'info');
    }
    this.refresh();
  }

  private async setProfile(id: string): Promise<void> {
    const p = profiles.quality_profiles.find((x) => x.id === id);
    if (!p) return;
    this.profileCur = p;
    savePrefs({ profile: id });
    const r = this.rendererObj;
    if (!r) return;
    try {
      await r.setProfile(p);
      this.host.markCold();
    } catch (e) {
      this.notice(`Смена профиля не удалась: ${String((e as Error)?.message ?? e)}`, 'bad');
    }
    this.refresh();
  }

  private effectiveTheme(): 'dark' | 'light' {
    const a = document.documentElement.getAttribute('data-theme');
    if (a === 'dark' || a === 'light') return a;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  private toggleTheme(): void {
    const next = this.effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    savePrefs({ theme: next });
    this.map?.readPalette();
    this.updateThemeButton();
  }

  private updateThemeButton(): void {
    byId('btn-theme').textContent = this.effectiveTheme() === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  }

  private mountTabs(): void {
    const bar = byId('tabs');
    const body = byId('tabpanel');
    for (const t of this.tabs) {
      const btn = h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}`, 'aria-selected': 'false' },
        h('span', { text: t.label }), h('span', { class: 'dot', hidden: true }));
      btn.addEventListener('click', () => this.openTab(t.id));
      btn.addEventListener('keydown', (e) => this.tabKey(e, t.id));
      bar.appendChild(btn);
      this.tabButtons.set(t.id, btn);
      const panel = h('section', { id: `panel-${t.id}`, role: 'tabpanel', 'aria-labelledby': `tab-${t.id}`, tabindex: '0', hidden: true });
      body.appendChild(panel);
      this.panels.set(t.id, panel);
      t.mount(panel);
    }
  }

  private tabKey(e: KeyboardEvent, id: TabId): void {
    const order = this.tabs.map((t) => t.id);
    const i = order.indexOf(id);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + order.length) % order.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = order.length - 1;
    if (next < 0) return;
    e.preventDefault();
    this.openTab(order[next]);
    this.tabButtons.get(order[next])?.focus();
  }

  // ------------------------------------------------------------------ viewport: renderer or 2D map
  private mountViewport(): void {
    const cams: [string, CameraMode][] = [['btn-cam-orbit', 'orbit'], ['btn-cam-route', 'route'], ['btn-cam-free', 'free']];
    for (const [id, m] of cams) {
      byId(id).addEventListener('click', () => {
        this.cameraMode = m;
        this.rendererObj?.focusActor(null);
        this.rendererObj?.setCameraMode(m);
        for (const [bid, bm] of cams) byId(bid).setAttribute('aria-pressed', String(bm === m));
      });
    }
    byId('btn-cam-overview').addEventListener('click', () => {
      this.rendererObj?.focusActor(null);
      this.cameraMode = 'orbit';
      this.rendererObj?.setCameraMode('orbit');
      for (const [bid, bm] of cams) byId(bid).setAttribute('aria-pressed', String(bm === 'orbit'));
    });
  }

  async startRenderer(): Promise<void> {
    const canvas = byId<HTMLCanvasElement>('scene');
    this.setStatus({ phase: 'probing', message: 'Проверка WebGPU' });
    try {
      const r = await createRenderer({
        canvas,
        profile: this.profileCur,
        scene,
        onFrame: (s: FrameSample) => this.host.addFrameSample(s),
        onStatus: (s: RendererStatus) => this.setStatus(s),
      });
      this.rendererObj = r;
      this.adapterInfo = r.adapter;
      this.mode = '3d';
      byId('cam-controls').hidden = false;
      r.setWorldView(this.host.worldView());
      if (document.visibilityState === 'hidden') r.pause();
      if (this.status.phase === 'ready') this.onReady();
    } catch (e) {
      this.enterCompat(e);
    }
    this.refresh();
  }

  private setStatus(s: RendererStatus): void {
    this.status = s;
    const overlay = byId('render-status');
    const busy = s.phase !== 'ready' && s.phase !== 'paused';
    overlay.hidden = !busy || this.mode === 'compat';
    byId('render-phase').textContent = PHASE_RU[s.phase] ?? s.phase;
    byId('render-msg').textContent = `${s.message ?? ''}${s.progress !== undefined ? ` — ${Math.round(s.progress * 100)}%` : ''}`;
    byId('render-bar').style.width = `${Math.round((s.progress ?? (s.phase === 'ready' ? 1 : 0)) * 100)}%`;
    byId('btn-start-now').hidden = this.host.isStarted || !busy;
    if (s.phase === 'ready') this.onReady();
    if (s.phase === 'lost' || s.phase === 'recovering') this.everReady && this.notice('Устройство WebGPU потеряно — рендер восстанавливается; симуляция и NPC продолжают работать.', 'warn');
  }

  private onReady(): void {
    this.host.markCold();
    if (!this.everReady) {
      this.everReady = true;
      this.host.start();
    }
  }

  private enterCompat(e: unknown): void {
    this.mode = 'compat';
    byId('render-status').hidden = true;
    byId('scene').hidden = true;
    const mapCanvas = byId<HTMLCanvasElement>('map2d');
    mapCanvas.hidden = false;
    const box = byId('compat');
    box.hidden = false;
    let reason: string;
    let adapter: AdapterSummary | null = null;
    if (isUnavailable(e)) {
      adapter = e.adapter;
      const why: Record<RendererUnavailable['reason'], string> = {
        'no-webgpu': 'браузер не предоставляет WebGPU (navigator.gpu отсутствует)',
        'no-adapter': 'WebGPU есть, но адаптер не получен (видеокарта или драйвер не поддерживаются, либо WebGPU выключен)',
        'device-failed': 'адаптер найден, но устройство WebGPU не создано',
        'insecure-context': 'страница открыта не в защищённом контексте (нужен HTTPS или localhost)',
      };
      reason = `${why[e.reason] ?? e.reason}. ${e.message}`;
    } else {
      reason = `ошибка запуска рендера: ${String((e as Error)?.message ?? e)}`;
    }
    this.adapterInfo = adapter;
    const a = adapter;
    box.replaceChildren(
      h('h3', { text: 'WebGPU недоступен — показана 2D-карта колонии' }),
      h('p', { id: 'compat-reason', text: `Причина: ${reason}` }),
      h('p', { class: 'small', text: 'Вся песочница агентов работает: ядро, экипаж, диалоги, Intent Authority, журнал и память. Для 3D-сцены нужен браузер с WebGPU (Chrome/Edge 113+, Safari 18+) или нативная сборка.' }),
      h('details', { id: 'compat-details' }, h('summary', { text: 'Подробности о браузере и адаптере' }), h('dl', null,
        h('dt', { text: 'WebGPU в браузере' }), h('dd', { text: 'gpu' in navigator ? 'объект navigator.gpu есть' : 'нет' }),
        h('dt', { text: 'Адаптер' }), h('dd', { text: a?.available ? [a.vendor, a.architecture, a.description].filter(Boolean).join(' · ') || 'без описания' : 'не получен' }),
        h('dt', { text: 'Защищённый контекст' }), h('dd', { text: (a?.secureContext ?? window.isSecureContext) ? 'да' : 'нет' }),
        h('dt', { text: 'Изоляция (COOP/COEP)' }), h('dd', { text: (a?.crossOriginIsolated ?? window.crossOriginIsolated) ? 'да' : 'нет (нужна только для многопоточного WASM)' }),
        h('dt', { text: 'Браузер' }), h('dd', { text: navigator.userAgent }),
      )),
    );
    this.map = new ColonyMap(mapCanvas);
    this.map.update(this.host.worldView(), this.host.snapshot);
    this.map.start();
    this.host.start();
  }

  // ------------------------------------------------------------------ periodic UI
  private uiTick(): void {
    const now = performance.now();
    if (now - this.lastWorldPush >= WORLD_PUSH_MS) {
      this.lastWorldPush = now;
      const view = this.host.worldView();
      this.rendererObj?.setWorldView(view);
      this.map?.update(view, this.host.snapshot);
    }
    this.renderHud();
    this.renderSubtitle();
    this.renderTopState();
    this.renderActive();
  }

  private renderActive(): void {
    const tab = this.tabs.find((t) => t.id === this.activeTab);
    try { tab?.render(); } catch (e) { console.error('[ui] tab render failed', e); }
    for (const t of this.tabs) {
      const n = t.badge?.() ?? 0;
      const dot = this.tabButtons.get(t.id)?.querySelector<HTMLElement>('.dot');
      if (!dot) continue;
      dot.hidden = n <= 0;
      if (n > 0 && dot.textContent !== String(n)) dot.textContent = String(n);
    }
  }

  private renderTopState(): void {
    const pause = byId('btn-pause');
    pause.textContent = this.host.paused ? 'Продолжить' : 'Пауза';
    pause.setAttribute('aria-pressed', String(this.host.paused));
    for (const id of Object.keys(this.host.providers) as ProviderId[]) {
      const opt = document.getElementById(`opt-provider-${id}`);
      if (!opt) continue;
      const st = this.host.providers[id].state();
      const text = `${this.host.providers[id].label}${st.state === 'ready' ? '' : ` — ${PROVIDER_STATE_RU[st.state] ?? st.state}`}`;
      if (opt.textContent !== text) opt.textContent = text;
    }
    byId('btn-start-now').hidden = this.host.isStarted || this.mode !== 'loading';
  }

  private renderHud(): void {
    const host = this.host;
    const s = host.snapshot;
    const frames = host.frames;
    const now = performance.now();
    const recent = frames.filter((f) => now - f.t < 10000 && f.intervalMs > 0).slice(-120);
    const iv = recent.map((f) => f.intervalMs).sort((a, b) => a - b);
    const gpu = recent.map((f) => f.gpuMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const last = frames[frames.length - 1];
    const mean = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : NaN;
    const state = !host.isStarted ? ['state-load', 'загрузка'] : host.paused ? ['state-pause', 'пауза'] : host.running ? ['state-run', 'идёт'] : ['state-pause', 'вкладка скрыта'];
    const a = this.adapterInfo;
    const sig = [clock(s.sim_time_s), host.speed, state[1], this.mode, num(1000 / mean, 1), num(percentile(iv, 0.5), 0), num(percentile(iv, 0.95), 0),
      gpu.length ? num(percentile(gpu, 0.5), 1) : '-', last?.renderScale, last?.internalSize?.join('x'), a?.description, s.emergency_lights].join('|');
    patch(byId('hud'), sig, () => [
      h('div', { class: 'hud-group' },
        h('span', { class: `chip ${state[0]}`, id: 'hud-sim' }, h('span', { class: 'k', text: 'смена' }), `${clock(s.sim_time_s)} · ×${host.speed} · ${state[1]}`),
        this.mode === '3d' ? [
          h('span', { class: 'chip', id: 'hud-fps' }, h('span', { class: 'k', text: 'FPS' }), Number.isFinite(mean) ? num(1000 / mean, 1) : '—'),
          h('span', { class: 'chip', id: 'hud-frame' }, h('span', { class: 'k', text: 'кадр' }), Number.isFinite(mean) ? `${ms(percentile(iv, 0.5), 0)} · p95 ${ms(percentile(iv, 0.95), 0)}` : '—'),
          h('span', { class: 'chip', id: 'hud-gpu' }, h('span', { class: 'k', text: 'GPU' }), gpu.length ? ms(percentile(gpu, 0.5), 1) : 'нет данных'),
          last ? h('span', { class: 'chip optional', id: 'hud-scale' }, h('span', { class: 'k', text: 'масштаб' }), `${num(last.renderScale, 3)} · ${last.internalSize[0]}×${last.internalSize[1]}`) : null,
        ] : null,
        this.mode === 'compat' ? h('span', { class: 'chip', id: 'hud-compat', text: '2D-карта · WebGPU недоступен' }) : null,
        s.emergency_lights ? h('span', { class: 'chip badge-soft', id: 'hud-emergency', text: 'аварийный свет' }) : null),
      h('div', { class: 'hud-group' },
        a?.available ? h('span', { class: 'chip optional', id: 'hud-adapter' }, h('span', { class: 'k', text: 'адаптер' }), [a.vendor, a.architecture].filter(Boolean).join(' · ') || a.description || '—') : null,
        a?.isSoftware ? h('span', { class: 'chip badge-soft', id: 'hud-software', text: 'программный адаптер — не замер' }) : null),
    ]);
  }

  private renderSubtitle(): void {
    const el = byId('subtitle');
    const sub = this.host.lastSubtitle;
    const visible = Boolean(sub && performance.now() - sub.at < SUBTITLE_MS);
    if (!visible || !sub) { el.hidden = true; return; }
    const sig = `${sub.npc}|${sub.text}`;
    el.hidden = false;
    patch(el, sig, () => [h('b', { text: `${labelOf(sub.npc)}: ` }), sub.text]);
  }

  // ------------------------------------------------------------------ visibility, route
  private onVisibility(): void {
    const hidden = document.visibilityState === 'hidden';
    const msg = this.host.setHidden(hidden);
    if (hidden) {
      this.rendererObj?.pause();
      if (msg) console.info('[app] пауза при скрытии вкладки:', msg);
    } else {
      this.rendererObj?.resume();
    }
  }

  runRoute(mode: 'quick' | 'full'): void {
    const r = this.rendererObj;
    if (!r || this.route.running) return;
    const soft = Boolean(this.adapterInfo?.isSoftware);
    const opts: RouteOptions = mode === 'full'
      ? { warmupPasses: 1, passes: 3, passDurationS: scene.control_route.duration_s }
      : soft ? { warmupPasses: 0, passes: 1, passDurationS: 12 } : { warmupPasses: 1, passes: 1, passDurationS: 60 };
    this.route.running = true;
    this.route.error = null;
    this.route.progress = 'подготовка';
    this.host.routeFixture = true;
    r.focusActor(null);
    r.setWorldView(this.host.worldView());
    r.runRoute({ ...opts, onProgress: (p) => { this.route.progress = `проход ${p.pass + 1}, ${p.segment}, t = ${num(p.t, 0)} с`; } })
      .then((report) => { this.route.report = report; })
      .catch((e: unknown) => { this.route.error = String((e as Error)?.message ?? e); })
      .finally(() => {
        this.route.running = false;
        this.host.routeFixture = false;
        r.setCameraMode(this.cameraMode);
        this.refresh();
      });
    this.refresh();
  }
}
