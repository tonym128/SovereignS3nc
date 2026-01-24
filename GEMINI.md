# SovereignS3nc Project Context for Gemini

## Project Overview
**SovereignS3nc** is a generic, offline-first data storage library written in TypeScript. It is designed to sync JSON-serializable data with any S3-compatible object storage (AWS S3, Oracle OCI, MinIO, Garage, etc.).

### Key Features
- **Offline-First**: Operates on local storage (In-Memory, File-based, or IndexedDB) and syncs when connectivity is available.
- **S3 Synchronization**: Two-way sync with conflict resolution (Last-Write-Wins strategy by default).
- **Encryption**: Optional transparent client-side AES-256-GCM encryption.
- **Sharing**: Supports private and public sharing of documents via specific S3 paths.
- **Pluggable Architecture**: Uses adapters for storage, cryptography, and remote communication.

## Architecture

### Core Components
- **`SovereignS3nc` Class** (`src/SovereignS3nc.ts`): The main entry point and facade. Manages the orchestration between local storage, remote storage, and synchronization logic.
- **Adapters**:
    - **Storage**: `IStorage` interface. Implementations include `InMemoryStorage` (Node/Testing), `IndexedDBStorage` (Browser).
    - **Remote**: `IRemoteAdapter` interface. `S3RemoteAdapter` handles S3 interactions.
    - **Crypto**: `ICryptoAdapter` interface. `AESCryptoAdapter` (Node) and `WebCryptoAdapter` (Browser).

### Data Flow
1.  **Local Write**: Data is written to the local adapter immediately.
2.  **Sync**:
    -   **Push**: Local changes are pushed to S3.
    -   **Pull**: Remote changes (identified by ETags/Timestamps) are downloaded and merged.
3.  **Conflict Resolution**: Defaults to Last-Write-Wins (LWW) or Deep Merge based on configuration.

### Security Model
- **Isolation**: Users are isolated by path prefixes: `${appId}/${userId}/${storeId}/`.
- **Encryption**: Data is encrypted *before* leaving the client. Keys are never stored in S3.
- **Sharing**:
    -   **Private**: Copies to `${appId}/shared/shared/private/...`
    -   **Public**: Metadata published to `${appId}/shared/shared/public/...` with unique keys.

## Development & Build

### Tech Stack
- **Language**: TypeScript (Strict mode).
- **Runtime**: Node.js (Dev/Build), Browser/Node.js (Usage).
- **Bundler**: `esbuild` for ESM and Browser IIFE bundles.
- **Testing**: `jest` with `ts-jest`.

### Scripts
- `npm run build`: Runs `tsc` (CommonJS), `build:esm` (ES Modules), and `build:global` (Browser Global).
- `npm test`: Runs Jest tests.

### Directory Structure
- `src/`: Source code.
    - `adapters/`: Concrete implementations of interfaces.
    - `interfaces/`: Core contracts (`IStorage`, `IRemoteAdapter`, etc.).
    - `modules/`: Feature-specific logic (e.g., `Boards`, `Social`).
    - `stubs/`: Browser/Node compatibility stubs.
- `dist/`: Compiled output.
- `tests/`: Unit and integration tests.
- `demo/`: Browser-based demo application.

## Coding Conventions
- **Asynchronous**: Most storage/network operations return `Promise`.
- **Typing**: Use explicit types. Avoid `any`.
- **Browser Compatibility**: Ensure code interacting with Node-specific APIs (like `crypto` or `fs`) uses the appropriate abstraction/adapter to remain browser-compatible.
- **Testing**: Write tests for new features. Mocks are often used for S3 calls.

## Key Files to Know
- `src/SovereignS3nc.ts`: Main logic.
- `src/index.ts`: Entry point exports.
- `package.json`: Dependencies and build scripts.
- `README.md`: Usage documentation.
