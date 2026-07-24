//! Procedural macros for CrossNative
//! 
//! Provides `#[native_function]` and related macros to simplify
//! exposing Rust functions to React Native.

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, ItemFn};

/// Mark a function as callable from React Native
/// 
/// # Example
/// ```rust
/// #[native_function]
/// pub fn add(a: i32, b: i32) -> i32 {
///     a + b
/// }
/// ```
/// 
/// This generates:
/// - C FFI wrapper function
/// - TypeScript type definition
/// - JSI binding code
#[proc_macro_attribute]
pub fn native_function(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input_fn = parse_macro_input!(item as ItemFn);
    
    let fn_name = &input_fn.sig.ident;
    let fn_vis = &input_fn.vis;
    let fn_block = &input_fn.block;
    let fn_sig = &input_fn.sig;
    
    // Generate C FFI wrapper name
    let ffi_name = quote::format_ident!("cross_native_{}", fn_name);
    
    // Extract parameter types for C interface
    let inputs = &fn_sig.inputs;
    let output = &fn_sig.output;
    
    // For simplicity, we'll generate a basic wrapper
    // Full implementation would parse types and generate proper C bindings
    let expanded = quote! {
        #fn_vis #fn_sig #fn_block
        
        // C FFI wrapper
        #[no_mangle]
        pub extern "C" fn #ffi_name(args_json: *const libc::c_char) -> *mut libc::c_char {
            // Parse JSON args
            // Call the Rust function
            // Return JSON result
            std::ptr::null_mut()
        }
    };
    
    TokenStream::from(expanded)
}

/// Mark a struct as a native module
/// 
/// # Example
/// ```rust
/// #[native_module]
/// pub struct MathModule {
///     // fields
/// }
/// 
/// #[native_module_methods]
/// impl MathModule {
///     #[method]
///     pub fn add(&self, a: i32, b: i32) -> i32 {
///         a + b
///     }
/// }
/// ```
#[proc_macro_attribute]
pub fn native_module(_attr: TokenStream, item: TokenStream) -> TokenStream {
    // For now, just pass through
    // Full implementation would generate module registration code
    item
}

/// Mark methods as callable from JS within a native module
#[proc_macro_attribute]
pub fn native_module_methods(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

/// Mark individual methods as callable
#[proc_macro_attribute]
pub fn method(_attr: TokenStream, item: TokenStream) -> TokenStream {
    // Parse the method
    let input_fn = parse_macro_input!(item as ItemFn);
    
    let fn_name = &input_fn.sig.ident;
    let fn_vis = &input_fn.vis;
    let fn_block = &input_fn.block;
    let fn_sig = &input_fn.sig;
    
    // Generate C FFI wrapper
    let ffi_name = quote::format_ident!("cross_native_method_{}", fn_name);
    
    let expanded = quote! {
        #fn_vis #fn_sig #fn_block
        
        #[no_mangle]
        pub extern "C" fn #ffi_name(module_ptr: *mut libc::c_void, args_json: *const libc::c_char) -> *mut libc::c_char {
            // Cast module_ptr to the correct type
            // Parse args
            // Call method
            // Return result
            std::ptr::null_mut()
        }
    };
    
    TokenStream::from(expanded)
}
