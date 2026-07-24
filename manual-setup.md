# Manual CrossNative Setup

## Problem

React Native CLI has a compatibility issue with Node.js v25. The `grey` color alias was removed.

## Workaround: Use Expo Instead

Expo is more stable and works with the latest Node.js.

```bash
# 1. Create Expo project
npx create-expo-app CrossNativeExample --template blank

# 2. Navigate to project
cd CrossNativeExample

# 3. Install dependencies
npm install react-native-cross-native react-native-nitro-modules

# 4. Generate native directories
npx expo prebuild

# 5. Setup iOS (macOS only)
cd ios && pod install && cd ..

# 6. Copy example files
mkdir -p native
cp ~/Documents/project/opensource/cross-native/example-app/native/compute.rs ./native/
cp ~/Documents/project/opensource/cross-native/example-app/App.tsx ./

# 7. Run
npx expo run:ios     # or run:android
```

## Alternative: Use Node.js 20

If you prefer React Native CLI:

```bash
# Install nvm (if not already)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install and use Node.js 20
nvm install 20
nvm use 20

# Now create project
npx react-native init CrossNativeExample
```

## Quick Test Without Native Setup

To test the concept immediately without iOS/Android setup:

```bash
# 1. Use the web prototype
cd ~/Documents/project/opensource/cross-native/packages/prototype

# 2. Compile Rust to WASM
rustc --target wasm32-unknown-unknown --crate-type=cdylib native/compute.rs

# 3. Create simple HTML page
cat > test.html << 'HTMLEOF'
<!DOCTYPE html>
<html>
<head><title>CrossNative Test</title></head>
<body>
  <div id="output"></div>
  <script>
    async function main() {
      const response = await fetch('compute.wasm');
      const wasmBytes = new Uint8Array(await response.arrayBuffer());
      
      const memory = new WebAssembly.Memory({ initial: 256 });
      const imports = { env: { memory, __memory_base: 0 } };
      
      const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
      
      const add = instance.exports.add;
      const result = add(1.5, 2.5);
      
      document.getElementById('output').innerHTML = 
        `<h1>CrossNative Test</h1><p>add(1.5, 2.5) = ${result}</p><p>✅ WASM is working!</p>`;
    }
    main();
  </script>
</body>
</html>
HTMLEOF

# 4. Serve
python3 -m http.server 8000
# Open http://localhost:8000/test.html
```

## Recommended Path Forward

1. **Immediate**: Test with web prototype (5 minutes)
2. **Short-term**: Use Expo for mobile app (30 minutes)
3. **Long-term**: Fix Node.js compatibility or use nvm
