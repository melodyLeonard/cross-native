//! Write plain Rust; call it from JavaScript, off the UI thread.
//!
//! ```ignore
//! use crossnative::crossnative;
//!
//! #[crossnative]
//! pub fn matrix_multiply(a: Vec<f64>, b: Vec<f64>, n: usize) -> Vec<f64> {
//!     // ordinary Rust — no pointers, no lengths, no manual memory
//! }
//! ```
//!
//! The macro generates a C-ABI shim next to your function and a small metadata
//! export describing its real signature. The host reads that metadata when the
//! module loads, so the JavaScript side gets a named, typed function with the
//! array marshalling done for it.
//!
//! # ABI
//!
//! Everything here is an implementation detail of the generated code, but it is
//! documented because the host must agree with it:
//!
//! - Slice arguments arrive as a `(pointer, length)` pair of `i32`s.
//! - Slice and string returns are packed into a single `i64`: the pointer in
//!   the high 32 bits, the element count in the low 32.
//! - Returned buffers are allocated with [`cn_alloc`], so the host releases
//!   them with [`cn_free`] once it has copied the contents out.

#![allow(clippy::missing_safety_doc)]

use std::alloc::{alloc, dealloc, Layout};

pub use crossnative_macro::crossnative;

/// Alignment for every host-facing allocation. Eight bytes so that `f64` and
/// `i64` buffers are always correctly aligned, whatever the element type.
pub const ALIGN: usize = 8;

/// Allocate `size` bytes inside the WASM linear memory.
///
/// Returns null on failure, which the host reports as an allocation error.
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

/// Combine a pointer and an element count into the single `i64` the host reads.
fn pack(ptr: *const u8, count: usize) -> u64 {
    ((ptr as u32 as u64) << 32) | (count as u32 as u64)
}

/// Copy `values` into a host-owned buffer and return its packed handle.
///
/// The copy is deliberate: `Vec` allocates with its element type's alignment,
/// but the host frees everything through [`cn_free`] at [`ALIGN`]. Re-allocating
/// keeps the two sides in agreement rather than relying on them coinciding.
pub fn pack_slice<T: Copy>(values: &[T]) -> u64 {
    let bytes = std::mem::size_of_val(values);
    if bytes == 0 {
        return pack(std::ptr::null(), 0);
    }

    let buffer = cn_alloc(bytes);
    if buffer.is_null() {
        return pack(std::ptr::null(), 0);
    }

    unsafe {
        std::ptr::copy_nonoverlapping(values.as_ptr() as *const u8, buffer, bytes);
    }
    pack(buffer, values.len())
}

/// Copy a string into a host-owned buffer as UTF-8 and return its handle.
pub fn pack_str(text: &str) -> u64 {
    pack_slice(text.as_bytes())
}

/// Rebuild a slice the host passed in.
///
/// # Safety
/// `ptr` must point to `len` initialised values of `T` inside linear memory.
pub unsafe fn slice_from<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    if ptr.is_null() || len == 0 {
        return &[];
    }
    std::slice::from_raw_parts(ptr, len)
}

/// Rebuild a `String` the host passed in as UTF-8 bytes.
///
/// Invalid UTF-8 is replaced rather than panicking, since a panic would trap
/// the whole module.
///
/// # Safety
/// `ptr` must point to `len` bytes inside linear memory.
pub unsafe fn string_from(ptr: *const u8, len: usize) -> String {
    String::from_utf8_lossy(slice_from(ptr, len)).into_owned()
}
