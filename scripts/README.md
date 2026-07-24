# CrossNative Scripts

Helper scripts for project setup and development.

## create-example-project.sh

Creates a complete React Native project with CrossNative pre-configured.

### Usage

```bash
cd /path/where/you/want/project
~/Documents/project/opensource/cross-native/scripts/create-example-project.sh
```

### What It Does

1. Creates React Native project `CrossNativeExample`
2. Installs `react-native-cross-native` and `react-native-nitro-modules`
3. Creates `native/compute.rs` with example functions
4. Copies working `App.tsx` with benchmarks
5. Runs `pod install` for iOS

### After Running

```bash
cd CrossNativeExample
npx react-native run-ios     # or run-android
```

Then build the native module:
```bash
npx cross-native build
```

## Requirements

- Node.js 18+
- React Native CLI
- For iOS: Xcode, CocoaPods
- For Android: Android Studio, Android SDK

## Troubleshooting

### "React Native CLI not found"
```bash
npm install -g @react-native-community/cli
```

### "pod install fails"
```bash
sudo xcode-select --install
brew install cocoapods
```

### "Android build fails"
- Open Android Studio
- Install SDK Platform 34
- Install Build Tools 34
- Set ANDROID_HOME environment variable
