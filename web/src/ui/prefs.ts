// UI preferences only (selected tab, profile, provider, theme). Storage may be unavailable or throw (private mode,
// sandboxed artifact, blocked site data): every access is guarded and the app works without it.
const KEY = 'zero-echo.ui-prefs.v1';

export interface Prefs {
  tab?: string;
  profile?: string;
  provider?: string;
  theme?: 'dark' | 'light';
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Prefs;
    return typeof p === 'object' && p ? p : {};
  } catch {
    return {};
  }
}

export function savePrefs(patch: Prefs): void {
  try {
    const next = { ...loadPrefs(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: preferences simply are not remembered
  }
}
