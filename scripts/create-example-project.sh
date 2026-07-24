#!/bin/bash
set -e

echo "🚀 Creating CrossNative Example Project"
echo ""

PROJECT_NAME="CrossNativeExample"

# Check if React Native CLI is installed
if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Install Node.js first."
    exit 1
fi

# Create React Native project
echo "📦 Creating React Native project..."
npx react-native init $PROJECT_NAME --version 0.73.0

cd $PROJECT_NAME

# Install CrossNative dependencies
echo "📦 Installing CrossNative..."
npm install react-native-cross-native react-native-nitro-modules

# Create native module directory
mkdir -p native

# Copy example Rust code
cat > native/compute.rs << 'EOF'
#[no_mangle]
pub extern "C" fn add(a: f64, b: f64) -> f64 {
    a + b
}

#[no_mangle]
pub extern "C" fn multiply(a: f64, b: f64) -> f64 {
    a * b
}

#[no_mangle]
pub extern "C" fn factorial(n: u32) -> u64 {
    if n <= 1 { 1 } else { (n as u64) * factorial(n - 1) }
}

#[no_mangle]
pub extern "C" fn matrix_multiply(
    a_ptr: *const f64,
    b_ptr: *const f64,
    result_ptr: *mut f64,
    n: usize,
) {
    if a_ptr.is_null() || b_ptr.is_null() || result_ptr.is_null() || n == 0 {
        return;
    }
    
    let a = unsafe { std::slice::from_raw_parts(a_ptr, n * n) };
    let b = unsafe { std::slice::from_raw_parts(b_ptr, n * n) };
    let result = unsafe { std::slice::from_raw_parts_mut(result_ptr, n * n) };
    
    for i in 0..(n * n) { result[i] = 0.0; }
    
    for i in 0..n {
        for j in 0..n {
            for k in 0..n {
                result[i * n + j] += a[i * n + k] * b[k * n + j];
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn process_dataset(data_ptr: *mut f64, len: usize) {
    if data_ptr.is_null() || len == 0 { return; }
    let data = unsafe { std::slice::from_raw_parts_mut(data_ptr, len) };
    for i in 0..len {
        let x = data[i];
        data[i] = x.sqrt().sin() * x.cos() + x.log1p();
    }
}
EOF

# Copy example App.tsx
cat > App.tsx << 'EOF'
import React, { useState, useCallback, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Button,
  ScrollView,
  ActivityIndicator,
} from 'react-native';

// Mock implementation until native module is built
const NativeMath = {
  add: async (a: number, b: number) => a + b,
  multiply: async (a: number, b: number) => a * b,
  factorial: async (n: number) => {
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
  },
  matrixMultiply: async (a: number[], b: number[], size: number) => {
    await new Promise(r => setTimeout(r, 10));
    const result = new Array(size * size).fill(0);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        for (let k = 0; k < size; k++) {
          result[i * size + j] += a[i * size + k] * b[k * size + j];
        }
      }
    }
    return result;
  },
  processDataset: async (data: Float64Array) => {
    await new Promise(r => setTimeout(r, 50));
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sqrt(data[i]) * Math.sin(data[i]) + Math.log1p(data[i]);
    }
    return data;
  },
};

interface BenchmarkResult {
  name: string;
  jsTime: number;
  nativeTime: number;
  speedup: number;
}

export default function App(): React.JSX.Element {
  const [logs, setLogs] = useState<string[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const runMatrixBenchmark = async () => {
    addLog('Running matrix multiplication benchmark...');
    setIsRunning(true);
    
    const sizes = [10, 50, 100];
    const results: BenchmarkResult[] = [];
    
    for (const size of sizes) {
      const a = Array.from({ length: size * size }, () => Math.random());
      const b = Array.from({ length: size * size }, () => Math.random());
      
      const jsStart = Date.now();
      const jsResult = new Array(size * size).fill(0);
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          for (let k = 0; k < size; k++) {
            jsResult[i * size + j] += a[i * size + k] * b[k * size + j];
          }
        }
      }
      const jsTime = Date.now() - jsStart;
      
      const nativeStart = Date.now();
      const nativeResult = await NativeMath.matrixMultiply(a, b, size);
      const nativeTime = Date.now() - nativeStart;
      
      const speedup = jsTime / nativeTime;
      results.push({ name: `${size}x${size}`, jsTime, nativeTime, speedup });
      addLog(`  ${size}x${size}: JS=${jsTime}ms Native=${nativeTime}ms ${speedup.toFixed(1)}x faster`);
    }
    
    setBenchmarks(results);
    setIsRunning(false);
  };

  const runDataProcessing = async () => {
    addLog('Processing large dataset...');
    setIsRunning(true);
    
    for (const size of [1000, 10000, 100000]) {
      const data = new Float64Array(size);
      for (let i = 0; i < size; i++) data[i] = Math.random();
      
      const start = Date.now();
      await NativeMath.processDataset(data);
      const time = Date.now() - start;
      
      addLog(`  ${size.toLocaleString()} items: ${time}ms`);
    }
    
    setIsRunning(false);
  };

  const runAll = async () => {
    addLog('═══ Starting All Benchmarks ═══');
    
    // Simple math
    addLog('Simple math...');
    const sum = await NativeMath.add(1.5, 2.5);
    addLog(`  add(1.5, 2.5) = ${sum}`);
    
    // Factorial
    addLog('Factorial...');
    const fact = await NativeMath.factorial(20);
    addLog(`  factorial(20) = ${fact}`);
    
    // Matrix
    await runMatrixBenchmark();
    
    // Data processing
    await runDataProcessing();
    
    addLog('═══ Complete ═══');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🚀 CrossNative</Text>
        <Text style={styles.subtitle}>Native Performance Demo</Text>
      </View>

      <View style={styles.buttonContainer}>
        <View style={styles.buttonRow}>
          <Button title="Matrix" onPress={runMatrixBenchmark} disabled={isRunning} />
          <View style={styles.buttonSpacer} />
          <Button title="Data" onPress={runDataProcessing} disabled={isRunning} />
        </View>
        <View style={styles.buttonRow}>
          <Button title="Run All" onPress={runAll} disabled={isRunning} />
          <View style={styles.buttonSpacer} />
          <Button title="Clear" onPress={() => { setLogs([]); setBenchmarks([]); }} disabled={isRunning} />
        </View>
      </View>

      {isRunning && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#6200ee" />
          <Text style={styles.loadingText}>Computing... UI stays responsive!</Text>
        </View>
      )}

      {benchmarks.length > 0 && (
        <View style={styles.benchmarkContainer}>
          <Text style={styles.benchmarkTitle}>📊 Results</Text>
          {benchmarks.map((b, i) => (
            <View key={i} style={styles.benchmarkRow}>
              <Text style={styles.benchmarkName}>{b.name}</Text>
              <View style={styles.benchmarkTimes}>
                <Text style={styles.benchmarkJs}>JS: {b.jsTime}ms</Text>
                <Text style={styles.benchmarkNative}>Native: {b.nativeTime}ms</Text>
              </View>
              <Text style={styles.benchmarkSpeedup}>{b.speedup.toFixed(1)}x</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.logsContainer}>
        <Text style={styles.logsTitle}>📝 Logs</Text>
        <ScrollView ref={scrollViewRef} style={styles.logsScroll}>
          {logs.length === 0 ? (
            <Text style={styles.logsEmpty}>Press a button to start...</Text>
          ) : (
            logs.map((log, i) => <Text key={i} style={styles.logEntry}>{log}</Text>)
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 16, backgroundColor: '#6200ee', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  buttonContainer: { padding: 16, gap: 8 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  buttonSpacer: { width: 8 },
  loading: { alignItems: 'center', padding: 16, backgroundColor: '#e3f2fd' },
  loadingText: { marginTop: 8, color: '#1565c0', fontWeight: '500' },
  benchmarkContainer: { margin: 16, padding: 16, backgroundColor: '#fff', borderRadius: 8, elevation: 2 },
  benchmarkTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  benchmarkRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  benchmarkName: { fontSize: 14, fontWeight: '600', width: 80 },
  benchmarkTimes: { flex: 1, alignItems: 'center' },
  benchmarkJs: { fontSize: 12, color: '#f44336' },
  benchmarkNative: { fontSize: 12, color: '#4caf50' },
  benchmarkSpeedup: { fontSize: 16, fontWeight: 'bold', color: '#6200ee', width: 60, textAlign: 'right' },
  logsContainer: { flex: 1, margin: 16, marginTop: 0, backgroundColor: '#fff', borderRadius: 8, elevation: 2, overflow: 'hidden' },
  logsTitle: { fontSize: 16, fontWeight: 'bold', padding: 12, backgroundColor: '#f5f5f5', borderBottomWidth: 1, borderBottomColor: '#eee' },
  logsScroll: { flex: 1 },
  logsEmpty: { textAlign: 'center', color: '#999', fontStyle: 'italic', padding: 24 },
  logEntry: { fontSize: 12, fontFamily: 'monospace', color: '#333', paddingVertical: 2, paddingHorizontal: 12 },
});
EOF

# Add build scripts to package.json
node -e "
const pkg = require('./package.json');
pkg.scripts = pkg.scripts || {};
pkg.scripts['native:build'] = 'cross-native build';
pkg.scripts['native:watch'] = 'cross-native build --watch';
require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

# iOS setup
echo "🍎 Setting up iOS..."
cd ios
pod install
cd ..

echo ""
echo "✅ Project created!"
echo ""
echo "Next steps:"
echo "  cd $PROJECT_NAME"
echo "  npx react-native run-ios    # or run-android"
echo ""
echo "Then build the native module:"
echo "  npx cross-native build"
EOF

chmod +x /Users/melodyleonard/Documents/project/opensource/cross-native/scripts/create-example-project.sh
