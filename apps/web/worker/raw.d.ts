declare module "*?raw" { const s: string; export default s; }
declare module "*.wasm?module" { const m: WebAssembly.Module; export default m; }
