# Contributing to CrossNative

Thank you for your interest in contributing! This document outlines how to get started.

## Development Setup

### Prerequisites
- Node.js 18+
- Rust (latest stable)
- React Native development environment (Xcode/Android Studio)

### Initial Setup
```bash
# Clone the repository
git clone https://github.com/yourusername/cross-native.git
cd cross-native

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

## Project Structure

```
packages/
  core/          - Main TypeScript API
  rust/          - Rust runtime and bindings
  cli/           - Command-line tools
cpp/             - C++ JSI bridge
examples/        - Example applications
```

## Development Workflow

### Building
```bash
# Build TypeScript packages
npm run build

# Build Rust runtime
cd packages/rust && cargo build

# Build everything with watch mode
npm run dev
```

### Testing
```bash
# Run all tests
npm test

# Run specific package tests
cd packages/core && npm test
cd packages/rust && cargo test

# Run benchmarks
cd packages/rust && cargo bench
```

### Linting
```bash
# Lint all packages
npm run lint

# Fix auto-fixable issues
npx eslint packages/core/src --fix
```

## Adding a New Language Backend

1. Create `packages/<language>/`
2. Implement the `NativeBinding` interface
3. Add code generation templates
4. Update CLI to support the new language
5. Add example app

## Commit Guidelines

- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
- Reference issues when applicable
- Keep commits focused and atomic

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create a release PR
4. After merge, CI will publish to npm

## Questions?

Open an issue or join our [Discord](https://discord.gg/crossnative).
