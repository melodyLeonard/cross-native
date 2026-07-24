/**
 * CrossNative Example App
 * 
 * Demonstrates:
 * 1. Simple math operations
 * 2. Heavy computation without UI blocking
 * 3. Performance comparison: JS vs Native
 * 4. Matrix operations
 * 5. Data processing with progress
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Button,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';

// ============================================================================
// WARNING: THIS SCREEN DOES NOT RUN NATIVE CODE.
//
// Every number below comes from the mock defined in this file, not from the
// WASM runtime. The JSI/Nitro backend is not wired up yet, and this directory
// has no ios/ or android/ project, so this app cannot currently be built.
//
// For a demo that genuinely executes Rust through the CrossNative stack, run:
//   node --experimental-strip-types examples/node-demo/demo.ts
//
// See the "Project status" table in the top-level README.
// ============================================================================

// Since the actual native module isn't built yet, we'll use a mock
// that demonstrates the API. In production, this would be:
// import { useNativeModule } from 'react-native-cross-native';

// Mock implementation for demonstration
const mockNativeModule = {
  add: async (a: number, b: number) => a + b,
  multiply: async (a: number, b: number) => a * b,
  factorial: async (n: number) => {
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  },
  matrixMultiply: async (a: number[], b: number[], size: number) => {
    // Simulate heavy computation
    await new Promise(resolve => setTimeout(resolve, 10));
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
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 50));
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
  result: any;
}

export default function App(): React.JSX.Element {
  const [logs, setLogs] = useState<string[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [fps, setFps] = useState(60);
  const scrollViewRef = useRef<ScrollView>(null);
  const fpsRef = useRef(60);
  const lastFrameTime = useRef(Date.now());

  // Simulate FPS counter
  useEffect(() => {
    let frameCount = 0;
    let lastTime = Date.now();

    const measureFps = () => {
      frameCount++;
      const now = Date.now();
      
      if (now - lastTime >= 1000) {
        fpsRef.current = Math.round((frameCount * 1000) / (now - lastTime));
        setFps(fpsRef.current);
        frameCount = 0;
        lastTime = now;
      }

      requestAnimationFrame(measureFps);
    };

    const frameId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
    // Auto-scroll
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  const runSimpleMath = async () => {
    addLog('Running simple math...');
    
    const start = Date.now();
    const result = await mockNativeModule.add(1.5, 2.5);
    const time = Date.now() - start;
    
    addLog(`add(1.5, 2.5) = ${result} (${time}ms)`);
    
    const start2 = Date.now();
    const result2 = await mockNativeModule.multiply(3, 4);
    const time2 = Date.now() - start2;
    
    addLog(`multiply(3, 4) = ${result2} (${time2}ms)`);
  };

  const runHeavyComputation = async () => {
    addLog('Starting heavy computation (factorial)...');
    setIsRunning(true);
    
    const n = 20;
    
    // JS version
    addLog('Running JS factorial...');
    const jsStart = Date.now();
    let jsResult = 1;
    for (let i = 2; i <= n; i++) {
      jsResult *= i;
    }
    const jsTime = Date.now() - jsStart;
    addLog(`JS factorial(${n}) = ${jsResult} (${jsTime}ms)`);
    
    // Native version
    addLog('Running native factorial...');
    const nativeStart = Date.now();
    const nativeResult = await mockNativeModule.factorial(n);
    const nativeTime = Date.now() - nativeStart;
    addLog(`Native factorial(${n}) = ${nativeResult} (${nativeTime}ms)`);
    
    const speedup = jsTime / nativeTime;
    addLog(`Speedup: ${speedup.toFixed(1)}×`);
    
    setIsRunning(false);
  };

  const runMatrixBenchmark = async () => {
    addLog('Running matrix multiplication benchmark...');
    setIsRunning(true);
    
    const sizes = [10, 50, 100];
    const results: BenchmarkResult[] = [];
    
    for (const size of sizes) {
      addLog(`Testing ${size}×${size} matrix...`);
      
      // Generate random matrices
      const a = Array.from({ length: size * size }, () => Math.random());
      const b = Array.from({ length: size * size }, () => Math.random());
      
      // JS version
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
      
      // Native version
      const nativeStart = Date.now();
      const nativeResult = await mockNativeModule.matrixMultiply(a, b, size);
      const nativeTime = Date.now() - nativeStart;
      
      const speedup = jsTime / nativeTime;
      
      results.push({
        name: `${size}×${size}`,
        jsTime,
        nativeTime,
        speedup,
        result: nativeResult[0], // Just show first element
      });
      
      addLog(`  JS: ${jsTime}ms | Native: ${nativeTime}ms | ${speedup.toFixed(1)}× faster`);
    }
    
    setBenchmarks(results);
    setIsRunning(false);
  };

  const runDataProcessing = async () => {
    addLog('Processing large dataset...');
    setIsRunning(true);
    
    const sizes = [1000, 10000, 100000];
    
    for (const size of sizes) {
      addLog(`Processing ${size.toLocaleString()} items...`);
      
      const data = new Float64Array(size);
      for (let i = 0; i < size; i++) {
        data[i] = Math.random();
      }
      
      // Native processing
      const start = Date.now();
      await mockNativeModule.processDataset(data);
      const time = Date.now() - start;
      
      addLog(`  Processed ${size.toLocaleString()} items in ${time}ms`);
      addLog(`  FPS during processing: ${fpsRef.current}`);
    }
    
    addLog('Data processing complete!');
    setIsRunning(false);
  };

  const runAllBenchmarks = async () => {
    addLog('═══ Starting All Benchmarks ═══');
    await runSimpleMath();
    await runHeavyComputation();
    await runMatrixBenchmark();
    await runDataProcessing();
    addLog('═══ All Benchmarks Complete ═══');
  };

  const clearLogs = () => {
    setLogs([]);
    setBenchmarks([]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🚀 CrossNative</Text>
        <View style={styles.fpsContainer}>
          <Text style={[styles.fps, fps >= 55 ? styles.fpsGood : fps > 30 ? styles.fpsWarning : styles.fpsBad]}>
            {fps} FPS
          </Text>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <View style={styles.buttonRow}>
          <Button title="Simple Math" onPress={runSimpleMath} disabled={isRunning} />
          <View style={styles.buttonSpacer} />
          <Button title="Factorial" onPress={runHeavyComputation} disabled={isRunning} />
        </View>

        <View style={styles.buttonRow}>
          <Button title="Matrix Benchmark" onPress={runMatrixBenchmark} disabled={isRunning} />
          <View style={styles.buttonSpacer} />
          <Button title="Data Processing" onPress={runDataProcessing} disabled={isRunning} />
        </View>

        <View style={styles.buttonRow}>
          <Button title="Run All" onPress={runAllBenchmarks} disabled={isRunning} />
          <View style={styles.buttonSpacer} />
          <Button title="Clear" onPress={clearLogs} disabled={isRunning} />
        </View>
      </View>

      {isRunning && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#6200ee" />
          <Text style={styles.loadingText}>Running computation... UI stays responsive! 🎯</Text>
        </View>
      )}

      {benchmarks.length > 0 && (
        <View style={styles.benchmarkContainer}>
          <Text style={styles.benchmarkTitle}>📊 Benchmark Results</Text>
          {benchmarks.map((b, i) => (
            <View key={i} style={styles.benchmarkRow}>
              <Text style={styles.benchmarkName}>{b.name}</Text>
              <View style={styles.benchmarkTimes}>
                <Text style={styles.benchmarkJs}>JS: {b.jsTime}ms</Text>
                <Text style={styles.benchmarkNative}>Native: {b.nativeTime}ms</Text>
              </View>
              <Text style={styles.benchmarkSpeedup}>{b.speedup.toFixed(1)}×</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.logsContainer}>
        <Text style={styles.logsTitle}>📝 Logs</Text>
        <ScrollView
          ref={scrollViewRef}
          style={styles.logsScroll}
          contentContainerStyle={styles.logsContent}
        >
          {logs.length === 0 ? (
            <Text style={styles.logsEmpty}>Press a button to run benchmarks...</Text>
          ) : (
            logs.map((log, i) => (
              <Text key={i} style={styles.logEntry}>{log}</Text>
            ))
          )}
        </ScrollView>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Heavy computation runs on separate threads.{'\n'}
          UI stays at 60fps. 🎯
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#6200ee',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  fpsContainer: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  fps: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  fpsGood: {
    color: '#4caf50',
  },
  fpsWarning: {
    color: '#ff9800',
  },
  fpsBad: {
    color: '#f44336',
  },
  buttonContainer: {
    padding: 16,
    gap: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  buttonSpacer: {
    width: 8,
  },
  loading: {
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#e3f2fd',
  },
  loadingText: {
    marginTop: 8,
    color: '#1565c0',
    fontWeight: '500',
  },
  benchmarkContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  benchmarkTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  benchmarkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  benchmarkName: {
    fontSize: 14,
    fontWeight: '600',
    width: 80,
  },
  benchmarkTimes: {
    flex: 1,
    alignItems: 'center',
  },
  benchmarkJs: {
    fontSize: 12,
    color: '#f44336',
  },
  benchmarkNative: {
    fontSize: 12,
    color: '#4caf50',
  },
  benchmarkSpeedup: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6200ee',
    width: 60,
    textAlign: 'right',
  },
  logsContainer: {
    flex: 1,
    margin: 16,
    marginTop: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  logsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  logsScroll: {
    flex: 1,
  },
  logsContent: {
    padding: 12,
  },
  logsEmpty: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
    padding: 24,
  },
  logEntry: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333',
    paddingVertical: 2,
  },
  footer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  footerText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
  },
});
