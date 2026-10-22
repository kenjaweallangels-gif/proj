// Route selection and privacy enforcement (Документ §11, §15, §17).
//
// * offline — only local routes (mock, loopback llama.cpp / local OpenAI-compatible server);
//   nothing leaves the machine.
// * hybrid  — local routes plus the explicit allowlist `privacy.hybrid_remote_allowlist`.
// * online  — local routes plus `privacy.online_remote_allowlist` (or every enabled remote route).
// The effective profile is the STRICTER of the session profile and the request's privacy_profile.
// There is no silent fallback: a route's fallback is used only when `fallback_route` names it AND the
// effective profile permits it.

import type { GatewayConfig, PrivacyProfile, RouteConfig } from './types.ts';
import type { Session } from './sessions.ts';

const RANK: Record<PrivacyProfile, number> = { offline: 0, hybrid: 1, online: 2 };

export function stricterProfile(a: PrivacyProfile, b: PrivacyProfile): PrivacyProfile {
  return RANK[a] <= RANK[b] ? a : b;
}

export type RouteCheck = { ok: true } | { ok: false; code: string; message: string };

export function routePermitted(cfg: GatewayConfig, route: RouteConfig, profile: PrivacyProfile, session?: Session | null): RouteCheck {
  if (!route.enabled) {
    return { ok: false, code: 'route_disabled', message: `маршрут ${route.id} выключен в конфигурации (нет ключа/разрешения владельца)` };
  }
  if (route.user_supplied_endpoint && session !== undefined && !session?.customEndpoint) {
    return { ok: false, code: 'custom_endpoint_not_registered', message: `маршрут ${route.id}: сессия не зарегистрировала собственный endpoint` };
  }
  if (route.locality === 'local') return { ok: true };
  if (profile === 'offline') {
    return { ok: false, code: 'privacy_blocked', message: `профиль offline: маршрут ${route.id} удалённый — отправка разговоров наружу запрещена` };
  }
  if (profile === 'hybrid' && !cfg.privacy.hybrid_remote_allowlist.includes(route.id)) {
    return { ok: false, code: 'privacy_blocked', message: `профиль hybrid: маршрут ${route.id} не входит в разрешённый список удалённых endpoint'ов` };
  }
  if (profile === 'online' && cfg.privacy.online_remote_allowlist !== 'all_enabled' && !cfg.privacy.online_remote_allowlist.includes(route.id)) {
    return { ok: false, code: 'privacy_blocked', message: `профиль online: маршрут ${route.id} не входит в разрешённый список` };
  }
  return { ok: true };
}

export function findRoute(cfg: GatewayConfig, id: string): RouteConfig | undefined {
  return cfg.routes.find((r) => r.id === id);
}

/** Route the request asks for: X-Echo-Route header, else the session's route, else the config default. */
export function requestedRouteId(cfg: GatewayConfig, session: Session, header: string | undefined): string {
  if (header && header.trim()) return header.trim();
  return session.route ?? cfg.default_route;
}

/** The configured fallback of `route`, only if it exists, is enabled and is permitted for `profile`. */
export function permittedFallback(cfg: GatewayConfig, route: RouteConfig, profile: PrivacyProfile, session: Session | null): RouteConfig | null {
  if (!route.fallback_route) return null;
  const fb = findRoute(cfg, route.fallback_route);
  if (!fb) return null;
  return routePermitted(cfg, fb, profile, session).ok ? fb : null;
}

export function routesForProfile(cfg: GatewayConfig, profile: PrivacyProfile, session: Session | null): RouteConfig[] {
  return cfg.routes.filter((r) => routePermitted(cfg, r, profile, session).ok);
}
