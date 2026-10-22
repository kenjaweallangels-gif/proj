// Linked by web/build.mjs when core/build-wasm/echo_core.mjs has not been built yet.
export default function createEchoCoreMissing() {
  return Promise.reject(new Error('Echo core WASM is not built: run tools/build_all.sh (or core/build_wasm.sh) first.'));
}
