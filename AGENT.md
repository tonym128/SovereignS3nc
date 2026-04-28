# SovereignS3nc Agent Guide

This document provides a technical map for AI agents and developers integrating or extending the **SovereignS3nc** library.

## 🧠 System Architecture

SovereignS3nc is an offline-first, end-to-end encrypted (E2EE) data synchronization engine. It bridges local persistence (IndexedDB/SQLite) with generic S3-compatible remote storage.

### Core Primitives
- **Identity**: Based on X25519 (tweetnacl). Public keys are the user's global ID.
- **Storage**: Namespaced by `appId/userId/storeId/`.
- **Encryption**: AES-256-GCM for data, X25519 for key exchange (DMs/Groups).
- **Sync**: ETag and SHA-256 manifest-based delta sync.

## 🛠️ Key API Patterns

### 1. Initialization (Ergonomic)
```typescript
const sov = await SovereignS3nc.create({
    paths: { appId: 'my-app', userId: 'alice', storeId: 'main' },
    password: 'user-secret-password',
    offline: false // Set true for local-only first
});
```

### 2. Module Registration
Modules use namespaced SQLite daily databases.
```typescript
const feed = new FeedModule(sov);
await sov.registerModule(feed);
```

### 3. Data Flow
- **Writes**: `sov.getStorage().saveDailyDb(...)` - writes are immediate to local storage.
- **Sync**: `await sov.sync()` - pushes local changes and pulls remote updates.
- **Conflicts**: Listen to `sov.on('conflict', (data) => ...)` and resolve via `sov.resolveConflict(id, choice)`.

## 🔒 Security Model (Critical)

- **Derivation**: Private keys are derived from the user password + SALT.
- **Privacy**: Private file paths on S3 are HMAC-hashed; an observer cannot see filenames or directory structures without the master key.
- **Integrity**: Every upload is accompanied by a SHA-256 hash in S3 metadata.

## 🤖 Integration Tips for Agents

- **Always use `SovereignS3nc.create()`**: Avoid manual constructor/init calls.
- **Prefer Modules**: Don't write raw files to S3; use the Module API to benefit from automated sync and schema migrations.
- **Handle Backgrounding**: Use `useWorker: true` for UI responsiveness during large syncs.
- **Conflict Strategy**: Always implement a UI for the `conflict` event to prevent data loss in multi-device scenarios.

## 📈 Scaling & Resilience

- **Automatic Retries**: All S3 operations implement exponential backoff with jitter (max 3 retries). This handles transient network failures and AWS/OCI rate limits.
- **PEX (Peer Exchange)**: Enable `enablePeerExchange: true` in WebRTC mode to allow peers to automatically discover and handshake with each other. This turns a single manual QR scan into an auto-expanding mesh network.

## 📂 File Structure Map
- `src/SovereignS3nc.ts`: Main entry point and orchestrator.
- `src/adapters/`: Storage (IndexedDB/Node) and Remote (S3/WebRTC) implementations.
- `src/modules/`: Specialized high-level logic (Feed, Messaging, Profile).
- `src/utils/`: Cryptography and Media processing.
