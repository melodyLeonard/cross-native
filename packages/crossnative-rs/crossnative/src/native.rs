//! Native FFI path — the module compiled as a static library and linked into
//! the app (iOS especially, where runtime-loaded code is forbidden).
//!
//! Where the WASM path hands the host a `.wasm`/`.aot` to load, here the Rust is
//! ordinary native code in the app binary. The host reaches it through one C
//! entry point, `crossnative_call`, matching what the C++ SharedLibraryModule
//! already dlsym's. Arguments and results cross as JSON, reusing the same
//! marshalling the WASM path uses — no linear memory, no pointer packing.
//!
//! `#[crossnative]` registers each function here via `inventory`, so a single
//! generated-free dispatcher can find them by name at runtime.

#![cfg(not(target_arch = "wasm32"))]

use serde_json::json;
pub use serde_json::Value;
use std::ffi::{c_char, CStr, CString};
use std::sync::Mutex;

/// One exported function, registered by the macro.
pub struct Function {
    pub name: &'static str,
    /// The function's signature, as the same JSON the WASM manifest uses.
    pub manifest: &'static str,
    /// Decode JSON args, call the function, encode the result.
    pub invoke: fn(&[Value]) -> Result<Value, String>,
}

inventory::collect!(Function);

fn find(name: &str) -> Option<&'static Function> {
    inventory::iter::<Function>.into_iter().find(|f| f.name == name)
}

/// Keeps returned strings alive until the next call frees them, so the host can
/// read the pointer we hand back without it dangling.
static LAST_RESULT: Mutex<Option<CString>> = Mutex::new(None);

fn respond(value: Value) -> *const c_char {
    let text = value.to_string();
    let cstring = CString::new(text).unwrap_or_default();
    let ptr = cstring.as_ptr();
    *LAST_RESULT.lock().unwrap() = Some(cstring);
    ptr
}

/// Handle one request. Shared by the C entry point; separated so it is testable.
fn dispatch(request: &str) -> Value {
    let parsed: Value = match serde_json::from_str(request) {
        Ok(value) => value,
        Err(e) => return json!({ "success": false, "error": format!("bad request JSON: {e}") }),
    };

    let name = parsed.get("function").and_then(Value::as_str).unwrap_or("");
    let args = parsed
        .get("args")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let Some(function) = find(name) else {
        return json!({ "success": false, "error": format!("function not found: {name}") });
    };

    match (function.invoke)(&args) {
        Ok(result) => json!({ "success": true, "result": result, "outputs": [] }),
        Err(error) => json!({ "success": false, "error": error }),
    }
}

/// The C entry point the host calls. Request and response are JSON, matching the
/// WASM result envelope exactly.
///
/// # Safety
/// `request` must be a valid NUL-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn crossnative_call(request: *const c_char) -> *const c_char {
    if request.is_null() {
        return respond(json!({ "success": false, "error": "null request" }));
    }
    let text = match CStr::from_ptr(request).to_str() {
        Ok(t) => t,
        Err(_) => return respond(json!({ "success": false, "error": "request not UTF-8" })),
    };
    respond(dispatch(text))
}

/// The module's manifest (every function's signature), as a JSON array. The host
/// reads it to build named, typed callables — the native mirror of the WASM
/// `__cn_meta_*` exports.
#[no_mangle]
pub extern "C" fn crossnative_manifest() -> *const c_char {
    let entries: Vec<Value> = inventory::iter::<Function>
        .into_iter()
        .filter_map(|f| serde_json::from_str(f.manifest).ok())
        .collect();
    respond(Value::Array(entries))
}

/// Encode any returned value to JSON. Used by macro-generated invoke closures.
pub fn encode<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// The JSON result for a function that returns nothing.
pub fn encode_void() -> Value {
    Value::Null
}

// --- Argument decoding, used by macro-generated invoke closures ---------------

/// Decode one JSON argument to a concrete number type.
pub fn arg_scalar<T: FromJson>(args: &[Value], i: usize) -> Result<T, String> {
    let value = args.get(i).ok_or_else(|| format!("missing argument {i}"))?;
    T::from_json(value).ok_or_else(|| format!("argument {i}: wrong type"))
}

/// Decode a JSON array argument to a Vec of numbers.
pub fn arg_vec<T: FromJson>(args: &[Value], i: usize) -> Result<Vec<T>, String> {
    let array = args
        .get(i)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("argument {i}: expected an array"))?;
    array
        .iter()
        .map(|v| T::from_json(v).ok_or_else(|| format!("argument {i}: bad element")))
        .collect()
}

/// Decode a JSON string argument.
pub fn arg_string(args: &[Value], i: usize) -> Result<String, String> {
    args.get(i)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("argument {i}: expected a string"))
}

/// Numbers the boundary understands.
pub trait FromJson: Sized {
    fn from_json(value: &Value) -> Option<Self>;
}

macro_rules! from_json_number {
    ($($t:ty),*) => {$(
        impl FromJson for $t {
            fn from_json(value: &Value) -> Option<Self> {
                value.as_f64().map(|n| n as $t)
            }
        }
    )*};
}
from_json_number!(f64, f32, i8, i16, i32, i64, u8, u16, u32, u64, usize, isize);

impl FromJson for bool {
    fn from_json(value: &Value) -> Option<Self> {
        value.as_bool().or_else(|| value.as_f64().map(|n| n != 0.0))
    }
}
