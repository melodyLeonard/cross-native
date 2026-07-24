require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "CrossNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{h,m,mm}",       # module that installs the JSI proxy
    "jsi/**/*.{hpp,cpp}",      # JSI binding layer
    "cpp/**/*.{h,hpp,c,cpp}",  # shared core
    "wasm3/**/*.{h,c}",        # vendored WASM interpreter
  ]

  # Only CrossNativeModule.h is part of the public surface; everything else is
  # implementation detail that should not leak into the app's header namespace.
  s.private_header_files = [
    "jsi/**/*.hpp",
    "cpp/**/*.{h,hpp}",
    "wasm3/**/*.h",
  ]

  s.dependency "React-Core"
  s.dependency "React-callinvoker"
  s.dependency "React-jsi"

  s.pod_target_xcconfig = {
    # wasm3.h and the core headers are included unqualified by their own sources.
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/wasm3\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp\"",
    ].join(" "),
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    # wasm3 relies on computed goto and takes the address of labels.
    "GCC_WARN_ABOUT_RETURN_TYPE" => "NO",
  }
end
