// What the tab modules may use from the app shell.
import type { AdapterSummary, QualityProfile, Renderer, RouteReport } from '../contracts.ts';
import type { AgentHost } from '../agent/host.ts';

export type TabId = 'crew' | 'dialogue' | 'authority' | 'world' | 'journal' | 'memory' | 'queue' | 'metrics' | 'budgets' | 'about';

export interface RouteRunState {
  running: boolean;
  progress: string;
  report: RouteReport | null;
  error: string | null;
}

export interface AppApi {
  readonly host: AgentHost;
  readonly dev: boolean;
  selectedNpc: string;
  selectNpc(id: string, opts?: { openDialogue?: boolean; focusCamera?: boolean }): void;
  openTab(id: TabId): void;
  renderer(): Renderer | null;
  adapter(): AdapterSummary | null;
  rendererMode(): 'loading' | '3d' | 'compat';
  profile(): QualityProfile;
  readonly route: RouteRunState;
  runRoute(mode: 'quick' | 'full'): void;
  /** Re-render the active tab right away (after a user action). */
  refresh(): void;
  /** Show a transient notice under the top bar. */
  notice(text: string, tone?: 'info' | 'warn' | 'bad'): void;
}

export interface Tab {
  readonly id: TabId;
  readonly label: string;
  /** Builds the static part of the tab once. */
  mount(el: HTMLElement): void;
  /** Updates the dynamic part; called ~4×/s while the tab is visible and right after user actions. */
  render(): void;
  /** Count shown on the tab button (e.g. plans awaiting a decision). */
  badge?(): number;
}
