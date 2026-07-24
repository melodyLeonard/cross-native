# CrossNative Decision Log

## 2026-05-03: Architecture Decision

**Decision:** Build on top of Nitro Modules + add WASM runtime for multi-language support

**Rationale:**
- Nitro is 16× faster than TurboModules (7ms vs 115ms for 100K calls)
- Nitrogen auto-generates TypeScript bindings
- Marc Rousavy (creator) is actively maintaining
- We can extend rather than compete

**Rejected alternatives:**
- Pure JSI from scratch: Too complex, 16+ weeks
- UniFFI only: Rust-only, doesn't solve "any language" requirement
- react-native-worklets: Still JavaScript execution

**Implementation strategy:**
1. Phase 1: Nitro-based core with Rust support (via WASM or direct)
2. Phase 2: Add Go, C++, Zig via WASM compilation
3. Phase 3: Plugin system (Sentry, OpenTelemetry)

## Next Actions
- Create Nitro module structure
- Implement WASM runtime
- Build example app with real benchmarks
