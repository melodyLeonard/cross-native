# CrossNative CLI

Command-line tool for building and managing CrossNative modules.

## Installation

```bash
npm install -g @cross-native/cli
# or
npx cross-native <command>
```

## Commands

### `init`

Initialize CrossNative in your React Native project.

```bash
cross-native init
```

Options:
- `-p, --path <path>` — Project path (default: `.`)
- `-l, --language <lang>` — Default language: `rust`, `go`, `cpp` (default: `rust`)
- `--skip-install` — Skip npm install

### `add`

Add a new native module.

```bash
cross-native add math
```

Options:
- `-l, --language <lang>` — Module language (default: `rust`)
- `-p, --path <path>` — Module path (default: `./native`)

### `build`

Compile native modules.

```bash
# Build all modules
cross-native build

# Watch mode (rebuild on file changes)
cross-native build --watch

# Release build (optimized)
cross-native build --release

# Build only Rust modules
cross-native build --language rust
```

### `run`

Start development mode with hot reload.

```bash
cross-native run
```

Options:
- `--ios` — Run on iOS simulator
- `--android` — Run on Android emulator
- `-p, --port <port>` — Metro bundler port (default: `8081`)

### `doctor`

Check development environment.

```bash
cross-native doctor
```

### `generate`

Generate TypeScript bindings from native source.

```bash
cross-native generate
```

## Configuration

Create `.cross-native/config.json`:

```json
{
  "language": "rust",
  "modulesDir": "./native",
  "outputDir": "./lib/native",
  "build": {
    "optLevel": 2,
    "target": "all",
    "debug": false
  }
}
```

## Examples

```bash
# Initialize in existing React Native project
cd MyApp
cross-native init

# Add a Rust math module
cross-native add math --language rust

# Build all modules
cross-native build

# Watch for changes and rebuild
cross-native build --watch

# Run the app with hot reload
cross-native run --ios
```
