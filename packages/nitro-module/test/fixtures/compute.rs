// CrossNative Example — Rust Compute Module
//
// Compile to WASM:
//   rustc --target wasm32-unknown-unknown --crate-type=cdylib -O compute.rs -o compute.wasm
//
// Functions taking a pointer operate on WASM linear memory. The host allocates
// that memory through the `cn_alloc` / `cn_free` exports below, copies data in,
// passes the resulting offset as an i32, and reads results back out.

use std::alloc::{alloc, dealloc, Layout};

/// Alignment used for every host-facing allocation. 8 bytes so that f64 slices
/// are always correctly aligned.
const ALIGN: usize = 8;

/// Allocate `size` bytes inside the WASM linear memory and return the offset.
///
/// Returns 0 on failure, which the host treats as an allocation error.
#[no_mangle]
pub extern "C" fn cn_alloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    match Layout::from_size_align(size, ALIGN) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Free a block previously returned by [`cn_alloc`].
///
/// `size` must match the size passed to `cn_alloc`.
#[no_mangle]
pub extern "C" fn cn_free(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(size, ALIGN) {
        unsafe { dealloc(ptr, layout) }
    }
}

/// Add two numbers
#[no_mangle]
pub extern "C" fn add(a: f64, b: f64) -> f64 {
    a + b
}

/// Multiply two numbers
#[no_mangle]
pub extern "C" fn multiply(a: f64, b: f64) -> f64 {
    a * b
}

/// Compute factorial
#[no_mangle]
pub extern "C" fn factorial(n: u32) -> u64 {
    (1..=(n as u64)).product::<u64>().max(1)
}

/// Fibonacci number (recursive, CPU intensive)
#[no_mangle]
pub extern "C" fn fibonacci(n: u32) -> u64 {
    if n <= 1 {
        n as u64
    } else {
        fibonacci(n - 1) + fibonacci(n - 2)
    }
}

/// Sum array elements
#[no_mangle]
pub extern "C" fn sum_array(data_ptr: *const f64, len: usize) -> f64 {
    if data_ptr.is_null() || len == 0 {
        return 0.0;
    }
    let data = unsafe { std::slice::from_raw_parts(data_ptr, len) };
    data.iter().sum()
}

/// Matrix-matrix multiplication (O(n³)), row-major, all matrices n×n.
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

    for i in 0..n {
        for j in 0..n {
            let mut sum = 0.0;
            for k in 0..n {
                sum += a[i * n + k] * b[k * n + j];
            }
            result[i * n + j] = sum;
        }
    }
}

/// Process large dataset element-wise, in place.
/// This is the kind of work that blocks the JS thread.
#[no_mangle]
pub extern "C" fn process_dataset(data_ptr: *mut f64, len: usize) {
    if data_ptr.is_null() || len == 0 {
        return;
    }
    let data = unsafe { std::slice::from_raw_parts_mut(data_ptr, len) };
    for x in data.iter_mut() {
        *x = x.sqrt().sin() * x.cos() + x.ln_1p();
    }
}

/// Benchmark function: heavy floating point computation
#[no_mangle]
pub extern "C" fn benchmark_heavy(iterations: u32) -> f64 {
    let mut sum = 0.0;
    for i in 0..iterations {
        let x = i as f64;
        sum += x.sqrt().sin() * x.cos();
    }
    sum
}
