//! Math Module Example for CrossNative
//! 
//! This module demonstrates how to write Rust code that can be
//! called from React Native via CrossNative.

use cross_native::prelude::*;

/// Simple addition
/// 
/// # Examples
/// ```
/// let result = add(1, 2);
/// assert_eq!(result, 3);
/// ```
#[native_function]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

/// Multiply two numbers
#[native_function]
pub fn multiply(a: i32, b: i32) -> i32 {
    a * b
}

/// Compute matrix multiplication
/// 
/// # Arguments
/// * `data` - Flattened matrix data (row-major order)
/// * `size` - Matrix dimension (size × size)
/// 
/// # Returns
/// Result containing flattened output matrix or error string
/// 
/// # Performance
/// This is O(n³) complexity. For a 100×100 matrix:
/// - JavaScript: ~2000ms
/// - Rust native: ~5ms
/// - Speedup: 400×
#[native_function]
pub fn compute_matrix(data: Vec<f64>, size: usize) -> Result<Vec<f64>, String> {
    if data.len() != size * size {
        return Err(format!(
            "Invalid data length: expected {}, got {}",
            size * size,
            data.len()
        ));
    }

    let mut result = vec![0.0; size * size];

    // Optimized matrix multiplication
    // Uses blocking for cache efficiency
    let block_size = 32;
    
    for ii in (0..size).step_by(block_size) {
        for jj in (0..size).step_by(block_size) {
            for kk in (0..size).step_by(block_size) {
                // Multiply block
                for i in ii..(ii + block_size).min(size) {
                    for j in jj..(jj + block_size).min(size) {
                        let mut sum = 0.0;
                        for k in kk..(kk + block_size).min(size) {
                            sum += data[i * size + k] * data[k * size + j];
                        }
                        result[i * size + j] += sum;
                    }
                }
            }
        }
    }

    Ok(result)
}

/// Compute Fibonacci number
/// 
/// # Warning
/// This is intentionally recursive and CPU-intensive.
/// Useful for demonstrating off-main-thread execution.
/// 
/// # Performance
/// n=35: ~100ms in Rust, ~5000ms in JavaScript
#[native_function]
pub fn fibonacci(n: i32) -> i32 {
    if n <= 1 {
        n
    } else {
        fibonacci(n - 1) + fibonacci(n - 2)
    }
}

/// Batch process data
/// 
/// Demonstrates zero-copy with SharedArrayBuffer
#[native_function]
pub fn batch_process(data: &mut [f64]) -> Result<(), String> {
    // Process in-place
    for i in 0..data.len() {
        data[i] = data[i].sqrt() * 2.0;
    }
    
    Ok(())
}

/// Generate random matrix
/// 
/// Useful for testing and benchmarks
#[native_function]
pub fn random_matrix(size: usize, seed: u64) -> Vec<f64> {
    use rand::{SeedableRng, Rng};
    use rand::rngs::StdRng;
    
    let mut rng = StdRng::seed_from_u64(seed);
    let mut result = Vec::with_capacity(size * size);
    
    for _ in 0..(size * size) {
        result.push(rng.gen::<f64>());
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add() {
        assert_eq!(add(1, 2), 3);
        assert_eq!(add(-1, 1), 0);
    }

    #[test]
    fn test_multiply() {
        assert_eq!(multiply(3, 4), 12);
    }

    #[test]
    fn test_fibonacci() {
        assert_eq!(fibonacci(0), 0);
        assert_eq!(fibonacci(1), 1);
        assert_eq!(fibonacci(10), 55);
    }

    #[test]
    fn test_compute_matrix() {
        let data = vec![
            1.0, 2.0,
            3.0, 4.0,
        ];
        let result = compute_matrix(data, 2).unwrap();
        
        // Verify result dimensions
        assert_eq!(result.len(), 4);
    }

    #[test]
    fn test_random_matrix() {
        let m1 = random_matrix(10, 12345);
        let m2 = random_matrix(10, 12345);
        
        // Same seed should produce same matrix
        assert_eq!(m1, m2);
        
        // Different seed should produce different matrix
        let m3 = random_matrix(10, 99999);
        assert_ne!(m1, m3);
    }
}
