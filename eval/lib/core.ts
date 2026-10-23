// Echo Runtime core (WASM build) driven through its single JSON entry point `echo_call` (docs/SPEC.md §1).
// The eval uses exactly the module the web client ships (core/build-wasm/echo_core.mjs) and the same call
// pattern as core/test_wasm_protocol.mjs: one fresh core per scene, all calls synchronous.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const WASM_MODULE_PATH = path.join(REPO_ROOT, 'core', 'build-wasm', 'echo_core.mjs');

interface EchoCoreModule {
  _echo_create(): number;
  _echo_destroy(core: number): void;
  _echo_call(core: number, requestPtr: number): number;
  _free(ptr: number): void;
  UTF8ToString(ptr: number): string;
  stringToNewUTF8(s: string): number;
}

/** Any core response: `{ok: true, ...}` or `{ok: false, error: {code, message}}`. */
export type CoreResponse = Record<string, any> & { ok: boolean; error?: { code: string; message: string } };

export class CoreError extends Error {
  readonly code: string;
  readonly cmd: string;
  constructor(cmd: string, code: string, message: string) {
    super(`${cmd}: ${code}: ${message}`);
    this.code = code;
    this.cmd = cmd;
  }
}

/** One core instance (a handle inside the shared WASM module). */
export class EchoCore {
  readonly #m: EchoCoreModule;
  #handle: number;

  constructor(m: EchoCoreModule) {
    this.#m = m;
    this.#handle = m._echo_create();
  }

  /** Raw call: returns the parsed response whatever `ok` is. */
  call(req: Record<string, unknown> | string): CoreResponse {
    if (this.#handle === 0) throw new Error('core destroyed');
    const ptr = this.#m.stringToNewUTF8(typeof req === 'string' ? req : JSON.stringify(req));
    try {
      return JSON.parse(this.#m.UTF8ToString(this.#m._echo_call(this.#handle, ptr))) as CoreResponse;
    } finally {
      this.#m._free(ptr);
    }
  }

  /** Call that throws CoreError on `{ok: false}`. */
  must(req: Record<string, unknown>): CoreResponse {
    const r = this.call(req);
    if (!r.ok) throw new CoreError(String(req.cmd), r.error?.code ?? 'unknown', r.error?.message ?? '');
    return r;
  }

  destroy(): void {
    if (this.#handle !== 0) this.#m._echo_destroy(this.#handle);
    this.#handle = 0;
  }
}

let modulePromise: Promise<EchoCoreModule> | null = null;

export async function loadCoreModule(): Promise<EchoCoreModule> {
  if (!modulePromise) {
    if (!fs.existsSync(WASM_MODULE_PATH)) {
      throw new Error(`нет ${WASM_MODULE_PATH}: сначала соберите ядро (bash core/build_wasm.sh)`);
    }
    modulePromise = import(pathToFileURL(WASM_MODULE_PATH).href).then(async (mod: { default: () => Promise<EchoCoreModule> }) => mod.default());
  }
  return modulePromise;
}

export async function createCore(): Promise<EchoCore> {
  return new EchoCore(await loadCoreModule());
}

export interface WorldFact {
  id: string;
  layer: string;
  protected: boolean;
  text_ru: string;
  about: string[];
}

/** The `init.data` object, same file set as core/cli/data_files.cpp and core/test_wasm_protocol.mjs. */
export interface CoreData {
  world: Record<string, any>;
  npcs: Record<string, any>;
  actions: Record<string, any>;
  profiles: Record<string, any>;
  speech: Record<string, any>;
  director: Record<string, any>;
  biography: Record<string, any>;
  layout: { anchors: unknown; zone_stand_points: unknown };
}

export function readJson<T = any>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function loadCoreData(dataDir = path.join(REPO_ROOT, 'data')): CoreData {
  const read = (rel: string) => readJson(path.join(dataDir, rel));
  const layout = read('scene/d0_layout.json');
  const data: CoreData = {
    world: read('world/zero_echo_d0.json'),
    npcs: read('npcs.json'),
    actions: read('actions.json'),
    profiles: read('profiles.json'),
    speech: read('speech_ru.json'),
    director: read('director_events.json'),
    biography: read('biography_details.json'),
    layout: { anchors: layout.anchors, zone_stand_points: layout.zone_stand_points },
  };
  return data;
}

/** Static facts about the world the scorer needs (ids, protected facts, actions, NPCs). */
export interface WorldIndex {
  facts: Map<string, WorldFact>;
  protectedFacts: Set<string>;
  npcIds: string[];
  npcNames: Map<string, string>;
  playerId: string;
  actions: Map<string, Record<string, any>>;
  /** Every id the world knows (zones, sensors, items, actors, doors, resources) → its kind. */
  entityKind: Map<string, string>;
  initialKnowledge: Map<string, Set<string>>;
}

export function indexWorld(data: CoreData): WorldIndex {
  const facts = new Map<string, WorldFact>();
  for (const f of data.world.facts as WorldFact[]) facts.set(f.id, f);
  const entityKind = new Map<string, string>();
  for (const z of data.world.zones) entityKind.set(z.id, 'zone');
  for (const d of data.world.doors) entityKind.set(d.id, 'door');
  for (const s of data.world.sensors) entityKind.set(s.id, 'sensor');
  for (const i of data.world.items) entityKind.set(i.id, 'item');
  for (const r of data.world.resources) entityKind.set(r.id, 'resource');
  for (const n of data.npcs.npcs) entityKind.set(n.id, 'actor');
  entityKind.set(data.npcs.player.id, 'player');
  const initialKnowledge = new Map<string, Set<string>>();
  for (const [actor, list] of Object.entries(data.world.initial_knowledge as Record<string, { fact: string }[]>)) {
    initialKnowledge.set(actor, new Set(list.map((k) => k.fact)));
  }
  return {
    facts,
    protectedFacts: new Set([...facts.values()].filter((f) => f.protected).map((f) => f.id)),
    npcIds: data.npcs.npcs.map((n: { id: string }) => n.id),
    npcNames: new Map(data.npcs.npcs.map((n: { id: string; name_ru: string }) => [n.id, n.name_ru])),
    playerId: data.npcs.player.id,
    actions: new Map(data.actions.actions.map((a: { id: string }) => [a.id, a])),
    entityKind,
    initialKnowledge,
  };
}
