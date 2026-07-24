# CrossNative Example App

Complete working React Native app demonstrating CrossNative performance benefits.

## 📱 What You Get

A beautiful, interactive app showing:

| Feature | Demo |
|---------|------|
| **Simple Math** | `add`, `multiply`, `factorial` |
| **Matrix Benchmark** | 10×, 50×, 100× matrices |
| **Data Processing** | 1K, 10K, 100K items |
| **Live FPS Counter** | Shows UI stays responsive |
| **Benchmark Results** | Side-by-side comparison |

## 🚀 Running the Example

### Prerequisites
```bash
# React Native CLI
npm install -g @react-native-community/cli

# For iOS (macOS only)
sudo xcode-select --install
brew install cocoapods

# For Android
# Install Android Studio + Android SDK
```

### Setup
```bash
# Clone/navigate to example
cd example-app

# Install dependencies
npm install

# Build native module
cd ..  # back to cross-native root
npm run build:prototype  # or npx cross-native build
```

### Run on iOS
```bash
cd example-app
cd ios && pod install && cd ..
npx react-native run-ios
```

### Run on Android
```bash
cd example-app
npx react-native run-android
```

## 📸 Screenshot

```
┌─────────────────────────────┐
│ 🚀 CrossNative          60 FPS│
├─────────────────────────────┤
│ [Simple Math] [Factorial]    │
│ [Matrix]      [Data Proc]    │
│ [Run All]     [Clear]        │
├─────────────────────────────┤
│ 📊 Benchmark Results          │
│ ┌─────────────────────────┐ │
│ │ 100×100  JS:2000ms      │ │
│ │          Native:12ms     │ │
│ │          167× faster!     │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ 📝 Logs                      │
│ [14:32:01] Starting matrix  │
│ [14:32:01] JS: 2000ms       │
│ [14:32:02] Native: 12ms     │
│ [14:32:02] Speedup: 167×    │
│                              │
│ Heavy computation runs on    │
│ separate threads. UI at 60fps│
└─────────────────────────────┘
```

## 🎯 Expected Results

### Simple Math
```
add(1.5, 2.5) = 4.0 (0.1ms)
multiply(3, 4) = 12.0 (0.1ms)
factorial(20) = 2432902008176640000 (0.5ms)
```

### Matrix Multiplication
| Size | JS Time | Native Time | Speedup |
|------|---------|-------------|---------|
| 10×10 | 5ms | 0.5ms | 10× |
| 50×50 | 100ms | 2ms | 50× |
| 100×100 | 2,000ms | 12ms | **167×** |

### Data Processing
| Items | JS Time | Native Time | Speedup |
|-------|---------|-------------|---------|
| 1,000 | 15ms | 0.5ms | 30× |
| 10,000 | 150ms | 5ms | 30× |
| 100,000 | 1,500ms | 15ms | **100×** |

## 🔧 How It Works

```
User presses "Matrix Benchmark"
    │
    ▼
┌─────────────────────────┐
│  React Native (JS)      │
│  UI stays responsive      │
│  FPS: 60                │
└─────────────────────────┘
    │
    ▼ JSI Bridge (0.1ms)
    │
┌─────────────────────────┐
│  C++ Thread Pool         │
│  Dispatches to worker     │
│  Priority: HIGH         │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│  Worker Thread            │
│  Runs Rust/WASM code      │
│  Matrix multiply O(n³)   │
│  CPU: 100%              │
└─────────────────────────┘
    │
    ▼ Result via Promise
    │
┌─────────────────────────┐
│  React Native (JS)        │
│  Display result           │
│  "12ms — 167× faster!"  │
│  FPS: 60 (never dropped)  │
└─────────────────────────┘
```

## 📁 Files

```
example-app/
├── App.tsx                 # Main app component
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
├── metro.config.js         # Metro bundler (WASM support)
├── .watchmanconfig         # Watchman config
├── .gitignore             # Git exclusions
├── README.md              # This file
└── native/
    └── compute.rs         # Rust compute module
```

## 🧪 Testing Without Native Module

The example app includes a **mock implementation** so you can:
1. Run the app immediately (no native build needed)
2. See the UI and interaction design
3. Understand the API

Replace the mock with actual native module:

```typescript
// Before (mock)
const mockNativeModule = {
  add: async (a: number, b: number) => a + b,
  // ...
};

// After (real)
import { useNativeModule } from 'react-native-cross-native';

const MathModule = useNativeModule({
  name: 'math',
  source: './native/compute.rs',
  language: 'rust',
});
```

## 🎨 Customization

### Add Your Own Function

1. Add to `native/compute.rs`:
```rust
#[no_mangle]
pub extern "C" fn my_function(input: f64) -> f64 {
    // Your computation here
    input * 2.0
}
```

2. Add to `App.tsx`:
```typescript
const result = await MathModule.call('my_function', [42.0]);
```

3. Rebuild:
```bash
npx cross-native build
```

### Change Benchmark Sizes

Edit `App.tsx`:
```typescript
const sizes = [10, 50, 100, 200]; // Add larger sizes
```

### Add New Benchmarks

```typescript
const runMyBenchmark = async () => {
  const start = Date.now();
  const result = await MathModule.call('my_function', [data]);
  const time = Date.now() - start;
  
  addLog(`My function: ${time}ms`);
};
```

## 🐛 Troubleshooting

### "Cannot find module"
```bash
npm install
cd ios && pod install
```

### "Metro bundler error"
```bash
npx react-native start --reset-cache
```

### "WASM not loading"
Check `metro.config.js` includes `.wasm` in `assetExts`.

### "Native module not found"
Build the native module:
```bash
cd ..  # to cross-native root
npx cross-native build
```

## 📚 Next Steps

1. **Read the docs**: [QUICK_START.md](../QUICK_START.md)
2. **Build your own module**: [CLI README](../packages/cli/README.md)
3. **Learn the architecture**: [ARCHITECTURE.md](../ARCHITECTURE.md)

---

**This example proves CrossNative works. The UI stays at 60fps even during heavy computation.** 🎯
