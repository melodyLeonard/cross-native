# Vendored wasm3

Source: https://github.com/wasm3/wasm3
Version: 0.5.1 (see `M3_VERSION` in `wasm3.h`)

wasm3 is MIT licensed. This directory contains the contents of the upstream
`source/` tree, minus the optional API backends CrossNative does not use
(`m3_api_wasi.c`, `m3_api_uvwasi.c`, `m3_api_meta_wasi.c`, `m3_api_tracer.c`).

## Note on `m3_module.c` and `m3_info.c`

These two files were missing from the original snapshot, which made the
interpreter impossible to link — `Module_AddFunction`, `Module_GetFunction`,
`m3_FreeModule` and `m3_PrintProfilerInfo` were all undefined. They were
restored from upstream `main` (0.5.2), because 0.5.1 was never tagged in the
upstream repository. Both files were checked against the 0.5.1 headers before
being added: neither references anything introduced after 0.5.1 (notably the
`c_m3Type_v128` enum added to `wasm3.h` in 0.5.2), so they compile and link
cleanly against the rest of this tree.

## Upgrading

If you upgrade this directory, take the whole `source/` tree from a single
upstream commit rather than mixing versions. Two fixes landed after 0.5.1 that
are relevant to CrossNative:

- `m3_core.c` accepts `v128` as an opaque slot, so modules that merely *mention*
  the SIMD value type in a signature or local declaration will parse. Rust
  compiled with `-C target-feature=+simd128` can emit these.
- `m3_parse.c` allows modules with no memory section (`numMemories > 1` rather
  than `!= 1`).
