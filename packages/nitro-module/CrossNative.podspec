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
  s.source       = { :git => "https://github.com/yourusername/cross-native.git", :tag => "#{s.version}" }

  s.source_files = [
    # Nitro Module files
    "ios/**/*.{swift,h,hpp,m,mm,c,cpp}",
    # Shared C++ files
    "cpp/**/*.{h,hpp,c,cpp}",
  ]

  s.private_header_files = [
    "cpp/**/*.h",
    "cpp/**/*.hpp",
  ]

  # Add any dependencies here
  s.dependency "React-NativeModulesApple"
  s.dependency "React-callinvoker"
  s.dependency "React-jsi"
  s.dependency "react-native-nitro-modules"

  # Swift/Objective-C interoperability
  s.pod_target_xcconfig = {
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) CROSSNATIVE_ENABLE_WASM=1",
    "OTHER_CPLUSPLUSFLAGS" => "$(inherited) -std=c++20",
    "SWIFT_COMPILATION_MODE" => "wholemodule",
  }

  # Install Nitrogen
  load File.join(File.dirname(`node --print "require.resolve('react-native-nitro-modules/package.json')"`), "scripts", "nitrogen.rb")
  nitrogen_install(s)
end
