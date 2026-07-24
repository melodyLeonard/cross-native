//! Test fixture: ordinary Rust, exported to JavaScript.
//!
//! Note what is *not* here — no pointers, no length parameters, no manual
//! allocation. `#[crossnative]` generates the C-ABI shim and the metadata that
//! lets the host call these by name with real arguments.

use crossnative::crossnative;

#[crossnative]
pub fn add(a: f64, b: f64) -> f64 {
    a + b
}

#[crossnative]
pub fn multiply(a: f64, b: f64) -> f64 {
    a * b
}

#[crossnative]
pub fn factorial(n: u32) -> u64 {
    (1..=(n as u64)).product::<u64>().max(1)
}

/// Recursive, so it exercises the interpreter's call stack.
#[crossnative]
pub fn fibonacci(n: u32) -> u64 {
    if n <= 1 {
        n as u64
    } else {
        fibonacci(n - 1) + fibonacci(n - 2)
    }
}

#[crossnative]
pub fn sum_array(values: Vec<f64>) -> f64 {
    values.iter().sum()
}

/// Row-major n×n matrix multiply, O(n³).
///
/// The length parameters the old C-ABI version needed are gone: `n` is derived
/// from the data, and the result is simply returned.
#[crossnative]
pub fn matrix_multiply(a: Vec<f64>, b: Vec<f64>) -> Vec<f64> {
    let n = (a.len() as f64).sqrt() as usize;
    if n == 0 || n * n != a.len() || a.len() != b.len() {
        return Vec::new();
    }

    let mut result = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..n {
            let mut sum = 0.0;
            for k in 0..n {
                sum += a[i * n + k] * b[k * n + j];
            }
            result[i * n + j] = sum;
        }
    }
    result
}

/// Element-wise transform: the kind of work that blocks the JS thread.
#[crossnative]
pub fn process_dataset(data: Vec<f64>) -> Vec<f64> {
    data.into_iter()
        .map(|x| x.sqrt().sin() * x.cos() + x.ln_1p())
        .collect()
}

/// Heavy floating point loop, with no data crossing the boundary.
#[crossnative]
pub fn benchmark_heavy(iterations: u32) -> f64 {
    let mut sum = 0.0;
    for i in 0..iterations {
        let x = i as f64;
        sum += x.sqrt().sin() * x.cos();
    }
    sum
}

/// Strings cross as UTF-8.
#[crossnative]
pub fn greet(name: String) -> String {
    format!("Hello, {name}!")
}
