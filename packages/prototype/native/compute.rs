// Minimal Rust module for CrossNative prototype
// Compile with: rustc --target wasm32-unknown-unknown --crate-type=cdylib compute.rs

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

/// Compute factorial (recursive, CPU intensive for large n)
#[no_mangle]
pub extern "C" fn factorial(n: u32) -> u64 {
    if n <= 1 {
        1
    } else {
        (n as u64) * factorial(n - 1)
    }
}

/// Sum of array elements
#[no_mangle]
pub extern "C" fn sum_array(data_ptr: *const f64, len: usize) -> f64 {
    if data_ptr.is_null() || len == 0 {
        return 0.0;
    }
    
    let data = unsafe { std::slice::from_raw_parts(data_ptr, len) };
    data.iter().sum()
}

/// Matrix-vector multiplication (O(n²))
/// result = matrix * vector
/// matrix is n×n stored in row-major order
#[no_mangle]
pub extern "C" fn matrix_vector_mult(
    matrix_ptr: *const f64,
    vector_ptr: *const f64,
    result_ptr: *mut f64,
    n: usize,
) {
    if matrix_ptr.is_null() || vector_ptr.is_null() || result_ptr.is_null() || n == 0 {
        return;
    }
    
    let matrix = unsafe { std::slice::from_raw_parts(matrix_ptr, n * n) };
    let vector = unsafe { std::slice::from_raw_parts(vector_ptr, n) };
    let result = unsafe { std::slice::from_raw_parts_mut(result_ptr, n) };
    
    for i in 0..n {
        result[i] = 0.0;
        for j in 0..n {
            result[i] += matrix[i * n + j] * vector[j];
        }
    }
}

/// Heavy computation: Matrix-matrix multiplication (O(n³))
/// result = a * b
/// All matrices are n×n stored in row-major order
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
    
    // Initialize result to zero
    for i in 0..(n * n) {
        result[i] = 0.0;
    }
    
    // Matrix multiplication with blocking for cache efficiency
    let block_size = 32;
    
    for ii in (0..n).step_by(block_size) {
        for jj in (0..n).step_by(block_size) {
            for kk in (0..n).step_by(block_size) {
                // Multiply block
                for i in ii..(ii + block_size).min(n) {
                    for j in jj..(jj + block_size).min(n) {
                        let mut sum = 0.0;
                        for k in kk..(kk + block_size).min(n) {
                            sum += a[i * n + k] * b[k * n + j];
                        }
                        result[i * n + j] += sum;
                    }
                }
            }
        }
    }
}

/// Process large dataset element-wise
/// This is the kind of work that blocks the JS thread
#[no_mangle]
pub extern "C" fn process_dataset(
    data_ptr: *mut f64,
    len: usize,
) {
    if data_ptr.is_null() || len == 0 {
        return;
    }
    
    let data = unsafe { std::slice::from_raw_parts_mut(data_ptr, len) };
    
    for i in 0..len {
        // Simulate complex computation
        let x = data[i];
        data[i] = x.sqrt().sin() * x.cos() + x.log1p();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_add() {
        assert_eq!(add(1.0, 2.0), 3.0);
        assert_eq!(add(-1.0, 1.0), 0.0);
    }
    
    #[test]
    fn test_multiply() {
        assert_eq!(multiply(3.0, 4.0), 12.0);
    }
    
    #[test]
    fn test_factorial() {
        assert_eq!(factorial(0), 1);
        assert_eq!(factorial(1), 1);
        assert_eq!(factorial(5), 120);
        assert_eq!(factorial(10), 3628800);
    }
}
