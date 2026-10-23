// Type of the Emscripten ES module built from core/ (see docs/SPEC.md §1). Resolved by web/build.mjs.
declare module 'echo-core-wasm' {
  export interface EchoCoreModule {
    _echo_create(): number;
    _echo_destroy(core: number): void;
    _echo_call(core: number, requestPtr: number): number;
    _malloc(size: number): number;
    _free(ptr: number): void;
    UTF8ToString(ptr: number): string;
    stringToNewUTF8(s: string): number;
  }
  const createEchoCore: (opts?: Record<string, unknown>) => Promise<EchoCoreModule>;
  export default createEchoCore;
}

// The same core compiled with -sWASM=0 (plain JavaScript); identical API.
declare module 'echo-core-js' {
  import type { EchoCoreModule } from 'echo-core-wasm';
  const createEchoCore: (opts?: Record<string, unknown>) => Promise<EchoCoreModule>;
  export default createEchoCore;
}
