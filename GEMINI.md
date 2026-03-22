# SovereignS3nc Project Context for Gemini

## Project Overview
**SovereignS3nc** is a generic, offline-first data storage library written in TypeScript. It is designed to sync JSON-serializable data, media blobs, and localized SQLite databases with any S3-compatible object storage (AWS S3, Oracle OCI, MinIO, Garage, etc.).

### Key Features
- **Offline-First**: Operates on local storage (`IndexedDB` in the browser) and syncs asynchronously when connectivity is available.
- **S3 Synchronization**: Two-way sync with conflict resolution (Last-Write-Wins and Timestamp checks).
- **End-to-End Encryption (E2EE)**: True asymmetric E2EE using `tweetnacl` (X25519 identity keys) combined with AES-256-GCM for payload encryption.
- **Pluggable Module Architecture**: Uses a generic module registration system so specialized modules (like `Feed`, `Messaging`, `Profile`) can be built cleanly with auto-namespaced paths (`public/modules/feed/`, etc.).
- **Social Graph & Discovery**: Follow users via a global registry (`users.json`), allowing background syncing of their public profiles, modules, and DMs.

## Architecture

### Core Components
- **`SovereignS3nc` Class** (`src/SovereignS3nc.ts`): The main entry point and facade. Manages the orchestration between local storage, remote storage, global discovery, and synchronization logic.
- **Module API**: Public methods like `getModulePath`, `getStorage`, `getConfig`, `encrypt`, `decrypt`, and `deriveSharedSecret` let Modules directly interact with the secure sync engine.
- **Adapters**:
    - **Storage**: `IStorage` interface. Implementations include `IndexedDBStorage` (Browser).
    - **Remote**: `IRemoteAdapter` interface. `S3RemoteAdapter` handles S3 interactions, with caching and intelligent ETags.

### Data Flow
1.  **Local Write**: Data is written to the local adapter via namespaced paths immediately.
2.  **Sync**:
    -   **Push**: Local changes are pushed to S3 if their SHA-256 hash or timestamps differ.
    -   **Pull**: Remote changes (identified by ETags/Timestamps/Hashes) are downloaded and merged.
    -   **Discovery**: Updates followed users' remote states automatically.

### Security Model
- **Isolation**: Users are isolated by path prefixes: `${appId}/${userId}/${storeId}/` for public sharing, and a derived deterministic **Private GUID** for private files.
- **End-to-End Encryption**: 
    - Files stored privately are encrypted symmetrically.
    - Direct Messages use `tweetnacl` Diffie-Hellman Key Exchange to derive a shared secret, securely encrypting the payload so only the recipient can read it.
- **Media Transports**: Images and large blobs can be shared securely by encrypting the blob reference and placing the raw encrypted data in public blob containers.

## Development & Build

### Tech Stack
- **Language**: TypeScript (Strict mode).
- **Runtime**: Node.js (Dev/Build), Browser/Node.js (Usage).
- **Bundler**: `esbuild` for ESM and Browser IIFE bundles.
- **Cryptography**: Node native `crypto` combined with `tweetnacl`.

### Scripts
- `npm run build`: Runs `tsc` (CommonJS), `build:esm` (ES Modules), and `build:global` (Browser Global).
- `npm run build:social`: Rebuilds the social demo application.
- `npm test`: Runs Jest unit tests.
- `npm run test:integration`: Runs live Garage S3-backed integration tests.
- `npm run test:browser`: Runs Playwright multi-user browser tests.

### Directory Structure
- `src/`: Core library code.
    - `adapters/`: S3, IndexedDB and SQLite Node logic.
    - `interfaces/`: Core contracts.
    - `modules/`: Specialized modules (`Profile`, `Messaging`, `Feed`).
- `dist/`: Compiled outputs.
- `tests/`: Extensive unit, integration, and browser testing.
- `demo/social/`: Fully featured React application demonstrating the library.

## Demo App (Social) Capabilities
- **Messaging**: End-to-end encrypted direct messaging with image support. Can edit and delete messages.
- **Feeds**: Public posting with nested comments, likes, and image attachments. Can edit and delete posts.
- **Profiles**: Profile picture (avatar) uploads with automatic compression (<100KB) and ETag-based syncing.
- **State Management**: Includes an exhaustive local reset capability.

## Coding Conventions
- **Asynchronous**: Most storage/network operations return `Promise`.
- **Browser Compatibility**: Polyfills like `path-browserify` and `crypto-browserify` are strictly used in `esbuild` so the library natively targets the browser.
- **Testing**: Tests must cover local mocks (`fake-indexeddb`) as well as live S3 integrations and Playwright browsers.