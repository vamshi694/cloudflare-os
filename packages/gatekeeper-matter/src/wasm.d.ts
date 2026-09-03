// Wrangler bundles a `.wasm` import as a compiled WebAssembly module (see the CompiledWasm rule in
// wrangler.jsonc); this tells TypeScript the same.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
