//! The `#[crossnative]` attribute.
//!
//! For a function like
//!
//! ```ignore
//! #[crossnative]
//! pub fn sum(values: Vec<f64>) -> f64 { values.iter().sum() }
//! ```
//!
//! this emits three things:
//!
//! 1. the function itself, untouched, so ordinary Rust callers still work;
//! 2. a C-ABI shim exported under the original name, which unpacks pointers
//!    and lengths and calls it;
//! 3. a `__cn_meta_sum` export returning JSON that describes the real
//!    signature, so the host can build a typed, named JavaScript function.
//!
//! The host never has to guess that `(ptr, len)` was one array argument,
//! because the metadata says so.

use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{parse_macro_input, FnArg, ItemFn, Pat, PathArguments, ReturnType, Type};

/// How a Rust type crosses the boundary.
enum Kind {
    /// A number or bool, passed by value.
    Scalar(String),
    /// `Vec<T>` (owned) or `&[T]` (borrowed), passed as pointer + length.
    Slice { elem: String, owned: bool },
    /// `String` (owned) or `&str` (borrowed), passed as UTF-8 pointer + length.
    Text { owned: bool },
    /// No value.
    Unit,
}

impl Kind {
    /// The name used in the metadata, and by the host to pick a marshaller.
    fn wire_name(&self) -> String {
        match self {
            Kind::Scalar(name) => name.clone(),
            Kind::Slice { elem, .. } => format!("vec<{elem}>"),
            Kind::Text { .. } => "string".to_string(),
            Kind::Unit => "void".to_string(),
        }
    }
}

const SCALARS: &[&str] = &[
    "f64", "f32", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "usize", "isize", "bool",
];

/// Extract `T` from a `Vec<T>`, if this path is one.
fn vec_element(path: &syn::Path) -> Option<String> {
    let segment = path.segments.last()?;
    if segment.ident != "Vec" {
        return None;
    }
    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };
    let syn::GenericArgument::Type(Type::Path(inner)) = args.args.first()? else {
        return None;
    };
    let ident = inner.path.get_ident()?.to_string();
    SCALARS.contains(&ident.as_str()).then_some(ident)
}

/// Classify a type, or explain why it is not supported.
fn classify(ty: &Type) -> Result<Kind, String> {
    match ty {
        Type::Tuple(tuple) if tuple.elems.is_empty() => Ok(Kind::Unit),

        Type::Path(path) => {
            if let Some(elem) = vec_element(&path.path) {
                return Ok(Kind::Slice { elem, owned: true });
            }
            let ident = path
                .path
                .get_ident()
                .map(|i| i.to_string())
                .ok_or_else(|| "unsupported type".to_string())?;

            if ident == "String" {
                return Ok(Kind::Text { owned: true });
            }
            if SCALARS.contains(&ident.as_str()) {
                return Ok(Kind::Scalar(ident));
            }
            Err(format!("unsupported type `{ident}`"))
        }

        Type::Reference(reference) => match &*reference.elem {
            Type::Slice(slice) => {
                let Type::Path(inner) = &*slice.elem else {
                    return Err("unsupported slice element".to_string());
                };
                let ident = inner
                    .path
                    .get_ident()
                    .map(|i| i.to_string())
                    .ok_or_else(|| "unsupported slice element".to_string())?;
                if !SCALARS.contains(&ident.as_str()) {
                    return Err(format!("unsupported slice element `{ident}`"));
                }
                Ok(Kind::Slice { elem: ident, owned: false })
            }
            Type::Path(path) if path.path.is_ident("str") => Ok(Kind::Text { owned: false }),
            _ => Err("unsupported reference type".to_string()),
        },

        _ => Err("unsupported type".to_string()),
    }
}

/// One parameter, as it appears in the shim.
struct Param {
    name: syn::Ident,
    kind: Kind,
}

fn parse_params(function: &ItemFn) -> Result<Vec<Param>, syn::Error> {
    let mut params = Vec::new();

    for arg in &function.sig.inputs {
        let FnArg::Typed(typed) = arg else {
            return Err(syn::Error::new_spanned(
                arg,
                "#[crossnative] cannot be used on methods that take self",
            ));
        };
        let Pat::Ident(ident) = &*typed.pat else {
            return Err(syn::Error::new_spanned(
                &typed.pat,
                "#[crossnative] needs a plain parameter name",
            ));
        };
        let kind = classify(&typed.ty).map_err(|message| {
            syn::Error::new_spanned(
                &typed.ty,
                format!("{message}. Supported: numbers, bool, Vec<number>, &[number], String, &str"),
            )
        })?;

        params.push(Param { name: ident.ident.clone(), kind });
    }

    Ok(params)
}

fn return_kind(function: &ItemFn) -> Result<Kind, syn::Error> {
    match &function.sig.output {
        ReturnType::Default => Ok(Kind::Unit),
        ReturnType::Type(_, ty) => classify(ty).map_err(|message| {
            syn::Error::new_spanned(
                ty,
                format!("{message} as a return type. Supported: numbers, bool, Vec<number>, String"),
            )
        }),
    }
}

/// Build the shim's parameter list and the statements that rebuild the real
/// arguments from it.
fn build_arguments(
    params: &[Param],
) -> (Vec<proc_macro2::TokenStream>, Vec<proc_macro2::TokenStream>, Vec<syn::Ident>) {
    let mut signature = Vec::new();
    let mut prologue = Vec::new();
    let mut call_args = Vec::new();

    for param in params {
        let name = &param.name;

        match &param.kind {
            Kind::Scalar(scalar) => {
                let ty = format_ident!("{}", scalar);
                signature.push(quote!(#name: #ty));
                call_args.push(name.clone());
            }
            Kind::Slice { elem, owned } => {
                let ptr = format_ident!("{}_ptr", name);
                let len = format_ident!("{}_len", name);
                let ty = format_ident!("{}", elem);
                signature.push(quote!(#ptr: *const #ty, #len: usize));

                prologue.push(if *owned {
                    quote!(let #name = unsafe { ::crossnative::slice_from(#ptr, #len) }.to_vec();)
                } else {
                    quote!(let #name = unsafe { ::crossnative::slice_from(#ptr, #len) };)
                });
                call_args.push(name.clone());
            }
            Kind::Text { owned } => {
                let ptr = format_ident!("{}_ptr", name);
                let len = format_ident!("{}_len", name);
                signature.push(quote!(#ptr: *const u8, #len: usize));

                prologue.push(quote!(let #name = unsafe { ::crossnative::string_from(#ptr, #len) };));
                if *owned {
                    call_args.push(name.clone());
                } else {
                    // &str borrows the String built above, which outlives the call.
                    let borrowed = format_ident!("{}_ref", name);
                    prologue.push(quote!(let #borrowed = #name.as_str();));
                    call_args.push(borrowed);
                }
            }
            Kind::Unit => {}
        }
    }

    (signature, prologue, call_args)
}

/// Mark a function as callable from JavaScript.
///
/// Supported parameter and return types: the numeric primitives, `bool`,
/// `Vec<number>`, `&[number]`, `String` and `&str`.
#[proc_macro_attribute]
pub fn crossnative(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let function = parse_macro_input!(item as ItemFn);

    let params = match parse_params(&function) {
        Ok(params) => params,
        Err(error) => return error.to_compile_error().into(),
    };
    let returns = match return_kind(&function) {
        Ok(kind) => kind,
        Err(error) => return error.to_compile_error().into(),
    };

    let name = function.sig.ident.clone();
    let export = name.to_string();
    let shim = format_ident!("__cn_shim_{}", name);
    let meta_shim = format_ident!("__cn_meta_shim_{}", name);
    let meta_export = format!("__cn_meta_{export}");

    let (signature, prologue, call_args) = build_arguments(&params);

    // Call the user's function and convert whatever it returned.
    let (return_type, body_tail) = match &returns {
        Kind::Unit => (quote!(), quote!(#name(#(#call_args),*);)),
        Kind::Scalar(scalar) => {
            let ty = format_ident!("{}", scalar);
            (quote!(-> #ty), quote!(#name(#(#call_args),*)))
        }
        Kind::Slice { .. } => (
            quote!(-> u64),
            quote!(::crossnative::pack_slice(&#name(#(#call_args),*))),
        ),
        Kind::Text { .. } => (
            quote!(-> u64),
            quote!(::crossnative::pack_str(&#name(#(#call_args),*))),
        ),
    };

    // Metadata describing the signature the *user* wrote, not the shim's.
    let param_entries: Vec<String> = params
        .iter()
        .map(|param| format!(r#"{{"name":"{}","type":"{}"}}"#, param.name, param.kind.wire_name()))
        .collect();
    let metadata = format!(
        r#"{{"name":"{}","params":[{}],"returns":"{}"}}"#,
        export,
        param_entries.join(","),
        returns.wire_name()
    );

    // Native path: decode JSON args, call the function, encode the result.
    // This mirrors the WASM shim but for the module compiled as a linked static
    // library (iOS), where there is no linear memory to marshal through.
    let mut native_decode = Vec::new();
    let mut native_args = Vec::new();
    for (index, param) in params.iter().enumerate() {
        let name = &param.name;
        match &param.kind {
            Kind::Scalar(scalar) => {
                let ty = format_ident!("{}", scalar);
                native_decode.push(quote!(let #name = ::crossnative::native::arg_scalar::<#ty>(args, #index)?;));
                native_args.push(quote!(#name));
            }
            Kind::Slice { elem, owned } => {
                let ty = format_ident!("{}", elem);
                native_decode.push(quote!(let #name = ::crossnative::native::arg_vec::<#ty>(args, #index)?;));
                native_args.push(if *owned { quote!(#name) } else { quote!(&#name) });
            }
            Kind::Text { owned } => {
                native_decode.push(quote!(let #name = ::crossnative::native::arg_string(args, #index)?;));
                native_args.push(if *owned { quote!(#name) } else { quote!(#name.as_str()) });
            }
            Kind::Unit => {}
        }
    }

    let native_call = match &returns {
        Kind::Unit => quote!({ #name(#(#native_args),*); Ok(::crossnative::native::encode_void()) }),
        _ => quote!(Ok(::crossnative::native::encode(#name(#(#native_args),*)))),
    };

    quote! {
        #function

        #[cfg(target_arch = "wasm32")]
        #[export_name = #export]
        pub extern "C" fn #shim(#(#signature),*) #return_type {
            #(#prologue)*
            #body_tail
        }

        #[cfg(target_arch = "wasm32")]
        #[export_name = #meta_export]
        pub extern "C" fn #meta_shim() -> u64 {
            ::crossnative::pack_str(#metadata)
        }

        #[cfg(not(target_arch = "wasm32"))]
        ::crossnative::inventory::submit! {
            ::crossnative::native::Function {
                name: #export,
                manifest: #metadata,
                invoke: |args: &[::crossnative::native::Value]|
                    -> ::core::result::Result<::crossnative::native::Value, ::std::string::String> {
                    #(#native_decode)*
                    #native_call
                },
            }
        }
    }
    .into()
}
