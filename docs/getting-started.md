# Getting Started with CrossNative

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 18+ installed
- **React Native** 0.73+ project (or Expo SDK 50+ with eject)
- **Rust** toolchain (for Rust modules)
- **Xcode** (for iOS) or **Android Studio** (for Android)

## Installation

### 1. Add CrossNative to Your Project

```bash
npm install cross-native
```

### 2. Install Language Support

For Rust:
```bash
npm install @cross-native/rust
```

### 3. Initialize CrossNative

```bash
npx cross-native init
```

This will:
- Create `native/` directory for your native code
- Configure build scripts
- Set up TypeScript code generation

## Your First Native Module

### 1. Create a Rust File

Create `native/math.rs`:

```rust
use cross_native::prelude::*;

#[native_function]
pub fn add(a: f64, b: f64) -> f64 {
    a + b
}

#[native_function]
pub fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}
```

### 2. Build the Module

```bash
npx cross-native build
```

This compiles Rust and generates TypeScript bindings.

### 3. Use in Your App

```typescript
import { useNativeModule } from 'cross-native';

const MathModule = useNativeModule({
  name: 'math',
  source: './native/math.rs',
  language: 'rust',
});

// Later in your component:
const result = await MathModule.call('add', [1, 2]);
console.log(result); // 3

const greeting = await MathModule.call('greet', ['World']);
console.log(greeting); // "Hello, World!"
```

## Handling Heavy Computation

### The Problem

```typescript
// ❌ This blocks the UI for 2+ seconds
function heavyComputation(data: number[]) {
  for (let i = 0; i < 1000000; i++) {
    // CPU-intensive work
  }
  return result;
}
```

### The CrossNative Solution

```rust
// native/heavy.rs
#[native_function]
pub fn process_data(data: Vec<f64>) -> Vec<f64> {
    // Runs on separate thread
    // UI stays responsive
    data.iter().map(|x| x * x).collect()
}
```

```typescript
// App.tsx
const HeavyModule = useNativeModule({
  name: 'heavy',
  source: './native/heavy.rs',
  language: 'rust',
});

// This won't block the UI!
const processed = await HeavyModule.call('processData', [largeArray], {
  priority: 'high',
});
```

## Configuration Options

### Call Options

```typescript
interface CallOptions {
  priority?: 'immediate' | 'high' | 'normal' | 'low';
  timeout?: number;           // Milliseconds
  zeroCopy?: boolean;         // Use SharedArrayBuffer
  signal?: AbortSignal;       // For cancellation
}
```

### Module Configuration

```typescript
interface NativeModuleConfig {
  name: string;               // Module identifier
  source: string;             // Path to native source
  language: 'rust' | 'go' | 'cpp';
  plugins?: Plugin[];         // Logging, metrics, etc.
  options?: Record<string, any>;
}
```

## Using Plugins

### Console Plugin

```typescript
import { useNativeModule, ConsolePlugin } from 'cross-native';

const MathModule = useNativeModule({
  name: 'math',
  source: './native/math.rs',
  language: 'rust',
  plugins: [
    ConsolePlugin({
      logArgs: true,
      logResults: true,
    }),
  ],
});

// Output:
// [CrossNative:math.add] Call args: [1, 2]
// [CrossNative:math.add] Completed in 0.5ms: 3
```

### Performance Plugin

```typescript
import { PerformancePlugin } from 'cross-native';

const MathModule = useNativeModule({
  name: 'math',
  source: './native/math.rs',
  language: 'rust',
  plugins: [
    PerformancePlugin({
      slowThresholdMs: 50,    // Warn if call takes >50ms
      keepHistory: true,      // Track all calls
    }),
  ],
});
```

## Advanced Usage

### Zero-Copy Data Transfer

For large arrays, use SharedArrayBuffer to avoid copying:

```typescript
import { createSharedBuffer } from 'cross-native';

// Create shared buffer
const buffer = createSharedBuffer(1024 * 1024); // 1MB

// Write data
const view = new Float64Array(buffer);
for (let i = 0; i < data.length; i++) {
  view[i] = data[i];
}

// Pass to native code - no copy!
const result = await Module.call('processBuffer', [buffer], {
  zeroCopy: true,
});
```

### Cancellation

```typescript
const controller = new AbortController();

// Start long-running task
const promise = Module.call('longTask', [], {
  signal: controller.signal,
});

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const result = await promise;
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Task was cancelled');
  }
}
```

## Debugging

### Enable Debug Logging

```typescript
const Module = useNativeModule({
  name: 'math',
  source: './native/math.rs',
  language: 'rust',
  plugins: [
    ConsolePlugin({
      level: 'debug',
      logArgs: true,
      logResults: true,
      logMetrics: true,
    }),
  ],
});
```

### Native Debugging

For Rust debugging:

```bash
# Build with debug symbols
npx cross-native build --debug

# Attach debugger (platform-specific)
# iOS: Use Xcode debugger
# Android: Use Android Studio or lldb
```

## Troubleshooting

### "JSI is not available"

Ensure you're using:
- React Native 0.68+
- Hermes or JSC (not Chrome debugger)
- New Architecture enabled (recommended)

### "Module not found"

1. Check that `source` path is correct
2. Run `npx cross-native build`
3. Verify native library is in build output

### "Native call timed out"

- Increase timeout: `{ timeout: 30000 }` (30 seconds)
- Check if native function is blocking (should use async)
- Verify thread pool has available workers

## Next Steps

- Read [Architecture](../ARCHITECTURE.md) for technical details
- Check [Examples](../examples/) for more code samples
- Join our [Discord](https://discord.gg/crossnative) for help

## Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **Discord**: Real-time chat and community support
- **Stack Overflow**: Tag with `cross-native`
