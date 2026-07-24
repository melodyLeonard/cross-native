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
    "wamr/core/iwasm/common/**/*.{h,c}",
    "wamr/core/iwasm/interpreter/**/*.{h,c}",
    "wamr/core/iwasm/aot/**/*.{h,c}",
    "wamr/core/shared/utils/**/*.{h,c}",
    "wamr/core/shared/mem-alloc/**/*.{h,c}",
    "wamr/core/shared/platform/ios/**/*.{h,c}",
    "wamr/core/shared/platform/include/**/*.{h,c}",
  ]

  s.private_header_files = [
    "jsi/**/*.hpp",
    "cpp/**/*.{h,hpp}",
    "wamr/core/**/*.h",
  ]

  s.dependency "React-Core"
  s.dependency "React-callinvoker"
  s.dependency "React-jsi"

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/cpp\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/iwasm/include\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/utils\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/mem-alloc\"",
      "\"$(PODS_TARGET_SRCROOT)/wamr/core/shared/platform/include\"",
    ].join(" "),
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "GCC_PREPROCESSOR_DEFINITIONS" => "WAMR_BUILD_AOT=1",
  }
end
