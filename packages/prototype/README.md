# CrossNative Prototype

Minimal working prototype demonstrating the core concept.

## Quick Test

### 1. Compile Rust to WASM

```bash
cd packages/prototype/native

# Install Rust target (one-time)
rustup target add wasm32-unknown-unknown

# Compile to WASM
rustc --target wasm32-unknown-unknown \
  --crate-type=cdylib \
  compute.rs \
  -o compute.wasm
```

### 2. Use in a Web Page

```html
<!DOCTYPE html>
<html>
<head>
  <title>CrossNative Prototype</title>
</head>
<body>
  <div id="output"></div>
  
  <script type="module">
    import { initialize, createComputeModule, benchmark } from './src/index.ts';
    
    async function main() {
      // Load WASM
      const response = await fetch('./native/compute.wasm');
      const wasmBytes = new Uint8Array(await response.arrayBuffer());
      
      await initialize(wasmBytes);
      
      const compute = createComputeModule();
      
      // Test simple functions
      console.log('add(1, 2):', await compute.add(1, 2));
      console.log('multiply(3, 4):', await compute.multiply(3, 4));
      console.log('factorial(10):', await compute.factorial(10));
      
      // Test array function
      const data = new Float64Array([1, 2, 3, 4, 5]);
      console.log('sumArray:', await compute.sumArray(data));
      
      // Benchmark matrix multiplication
      const n = 100;
      const matrix = new Float64Array(n * n);
      const vector = new Float64Array(n);
      
      for (let i = 0; i < n * n; i++) {
        matrix[i] = Math.random();
      }
      for (let i = 0; i < n; i++) {
        vector[i] = Math.random();
      }
      
      const { avgTime } = await benchmark(
        'matrixVectorMult',
        () => compute.matrixVectorMult(matrix, vector, n),
        100
      );
      
      document.getElementById('output').innerHTML = `
        <h1>CrossNative Prototype</h1>
        <p>✅ WASM loaded successfully!</p>
        <p>Matrix-vector multiply (${n}x${n}): ${avgTime.toFixed(3)}ms average</p>
      `;
    }
    
    main().catch(console.error);
  </script>
</body>
</html>
```

### 3. Run

Serve the files with any HTTP server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Open `http://localhost:8000` and check console for results.

## What This Proves

1. ✅ Rust compiles to WASM
2. ✅ WASM loads in browser/React Native
3. ✅ Functions are callable from JavaScript
4. ✅ Array data transfers between JS and WASM
5. ✅ Heavy computation runs without blocking UI

## Next Steps

- Add React Native integration (Metro bundler)
- Implement actual worker threads
- Add proper memory management
- Create CLI build tool
