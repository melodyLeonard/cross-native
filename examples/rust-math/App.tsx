import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useNativeModule, ConsolePlugin, PerformancePlugin } from 'cross-native';

// Define the Rust module configuration
const mathConfig = {
  name: 'math',
  source: './native/math.rs',
  language: 'rust' as const,
  plugins: [
    ConsolePlugin({ logArgs: true, logResults: true }),
    PerformancePlugin({ slowThresholdMs: 50 }),
  ],
};

// TypeScript types (would be auto-generated from Rust)
interface MathModule {
  add(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
  computeMatrix(data: number[], size: number): Promise<number[]>;
  fibonacci(n: number): Promise<number>;
}

export default function App() {
  const math = useNativeModule(mathConfig);
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const addResult = useCallback((label: string, value: unknown) => {
    setResults((prev) => [...prev, `${label}: ${JSON.stringify(value)}`]);
  }, []);

  const runTests = async () => {
    setLoading(true);
    setResults([]);

    try {
      // Test 1: Simple addition
      const sum = await math.call('add', [1, 2]);
      addResult('1 + 2', sum);

      // Test 2: Matrix multiplication (heavy computation)
      const size = 100;
      const matrix = Array.from({ length: size * size }, () => Math.random());
      const start = Date.now();
      const result = await math.call('computeMatrix', [matrix, size], {
        priority: 'high',
      });
      addResult(
        `Matrix ${size}x${size}`,
        `Completed in ${Date.now() - start}ms`
      );

      // Test 3: Fibonacci (recursive, CPU intensive)
      const fibStart = Date.now();
      const fib = await math.call('fibonacci', [35], {
        priority: 'high',
        timeout: 5000,
      });
      addResult(`Fibonacci(35)`, `${fib} (${Date.now() - fibStart}ms)`);
    } catch (error) {
      addResult('Error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>CrossNative Example</Text>
      <Text style={styles.subtitle}>Rust Math Module</Text>

      <Button
        title={loading ? 'Running...' : 'Run Tests'}
        onPress={runTests}
        disabled={loading}
      />

      {loading && (
        <ActivityIndicator style={styles.spinner} size="large" color="#0000ff" />
      )}

      <View style={styles.results}>
        {results.map((result, index) => (
          <View key={index} style={styles.resultItem}>
            <Text style={styles.resultText}>{result}</Text>
          </View>
        ))}
      </View>

      <View style={styles.info}>
        <Text style={styles.infoTitle}>How it works:</Text>
        <Text style={styles.infoText}>
          1. Rust code compiles to native library{'\n'}
          2. JSI bridge loads the library at runtime{'\n'}
          3. Functions run on separate threads{'\n'}
          4. Results return as Promises{'\n'}
          5. UI stays responsive throughout
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  spinner: {
    marginVertical: 20,
  },
  results: {
    marginTop: 20,
  },
  resultItem: {
    backgroundColor: '#fff',
    padding: 10,
    marginBottom: 10,
    borderRadius: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 14,
  },
  info: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#e3f2fd',
    borderRadius: 5,
  },
  infoTitle: {
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoText: {
    lineHeight: 20,
  },
});
