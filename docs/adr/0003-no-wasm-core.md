# No WASM core

The research measured a WASM SIMD core at about 2× faster than a JS core warm, and about 1.5×
cold. We build the JS core only.

At the 20 MB Salesforce log cap the gap is about 20 ms warm. On tiny logs JS wins, because WASM
must compile first. The rules the prototypes left out would run in JS for both cores, so the gap
gets smaller.

The cost of WASM:

- a C or Rust toolchain;
- `wasm-unsafe-eval` in the webview CSP;
- every hot rule written twice;
- a copy of the columns out of WASM memory in a worker.

The column layout stays stable, so a WASM core can come later with no API change. Add one only if
profiles of real logs show that parsing is still what users wait for.
