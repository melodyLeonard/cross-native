# CrossNative Quick Start

## Installation

```bash
# 1. Install CrossNative
npm install react-native-cross-native

# 2. Install Nitro Modules (peer dependency)
npm install react-native-nitro-modules

# 3. iOS setup
cd ios && pod install

# 4. Android setup
# Already handled by autolinking
```

## Your First Native Function

### Step 1: Write Rust

Create `native/math.rs`:

```rust
#[no_mangle]
pub extern "C" fn add(a: f64, b: f64) -> f64 {
    a + b
}
```

### Step 2: Build

```bash
npx cross-native build
```

### Step 3: Use in React Native

```tsx
import { useNativeModule } from 'react-native-cross-native';

function App() {
  const Math = useNativeModule({
    name: 'math',
    source: './native/math.rs',
    language: 'rust',
  });

  async function onPress() {
    const result = await Math.call('add', [1, 2]);
    console.log(result); // 3
  }

  return <Button title="Add" onPress={onPress} />;
}
```

## Heavy Computation (The Real Use Case)

### The Problem

```tsx
// ❌ This blocks the UI for 2+ seconds
function processLargeDataset(data: number[]) {
  for (let i = 0; i < data.length; i++) {
    // CPU-intensive work
    data[i] = Math.sqrt(data[i]) * Math.sin(data[i]);
  }
  return data;
}
```

### The Solution

```rust
// native/process.rs
#[no_mangle]
pub extern "C" fn process_data(
    data_ptr: *mut f64,
    len: usize
) {
    let data = unsafe { 
        std::slice::from_raw_parts_mut(data_ptr, len) 
    };
    
    for i in 0..len {
        data[i] = data[i].sqrt() * data[i].sin();
    }
}
```

```tsx
// App.tsx
const Processor = useNativeModule({
  name: 'process',
  source: './native/process.rs',
  language: 'rust',
});

async function onPress() {
  const data = new Float64Array(1000000);
  
  // ✅ Runs on separate thread - UI stays responsive!
  await Processor.call('process_data', [data], {
    priority: 'high',
    zeroCopy: true, // No data copying
  });
}
```

## Configuration

### useNativeModule Options

```tsx
const Module = useNativeModule({
  name: 'myModule',           // Unique identifier
  source: './native/code.rs', // Path to source
  language: 'rust',           // 'rust' | 'go' | 'cpp' | 'wasm'
  
  plugins: [
    ConsolePlugin(),         // Debug logging
    PerformancePlugin(),     // Track slow calls
  ],
});
```

### Call Options

```tsx
await Module.call('myFunction', [arg1, arg2], {
  priority: 'high',     // 'immediate' | 'high' | 'normal' | 'low'
  timeout: 5000,        // 5 second timeout
  zeroCopy: true,       // Use shared memory (no copy)
});
```

## Supported Languages

| Language | Status | Compile To |
|----------|--------|-----------|
| Rust | ✅ Ready | WASM |
| Go | 🟡 Beta | WASM (TinyGo) |
| C++ | 🟡 Beta | Native (.so/.dylib) |
| Zig | 🔵 Planned | WASM |
| AssemblyScript | 🔵 Planned | WASM |

## Examples

- [Math operations](examples/rust-math) — Basic + heavy compute
- [Image processing](examples/image-processing) — Pixel manipulation
- [Crypto](examples/crypto) — SHA-256, encryption
- [ML inference](examples/ml) — ONNX runtime

## Troubleshooting

### "JSI is not available"

Make sure you're using:
- React Native 0.73+
- Hermes or JSC (not Chrome debugger)
- New Architecture (recommended)

### "Module not found"

1. Check `source` path is correct
2. Run `npx cross-native build`
3. Verify WASM file exists in `build/` directory

### "Call timed out"

```tsx
await Module.call('slowFunction', [], {
  timeout: 30000, // Increase to 30 seconds
});
```

## Next Steps

- Read [full documentation](docs/)
- Check [API reference](docs/api.md)
- See [architecture](ARCHITECTURE.md)
- Join [Discord](https://discord.gg/crossnative)
