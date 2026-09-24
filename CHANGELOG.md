# Changelog

All notable changes to SovereignS3nc will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.2.0] — 2026-09-24

### Security — Cryptographic Hardening

- **HKDF-SHA256 (RFC 5869) for X25519 shared secrets** (`KeyManager.ts`)
  - Added `KeyManager.hkdfSha256()` — a cross-platform RFC 5869 HKDF implementation using Node's `createHmac`.
  - `deriveSharedSecret()` now applies HKDF with an info domain label (`SovereignS3nc-DM-v2`) instead of using the raw X25519 output directly as an AES key.
  - Backward-compatibility shim: pass `'SovereignS3nc-DM-v1-raw'` context to get the pre-HKDF legacy secret for decrypting old ciphertext.
  - **Why**: Raw X25519 output is a group element, not uniformly random key material; HKDF provides correct extraction and domain separation per RFC 5869 §2.2.

- **Forward Secrecy — Ephemeral ECDH per-message keys** (`KeyManager.ts`, `Messaging.ts`)
  - Added `deriveEphemeralSharedSecret(recipientPublicKey)` — generates a fresh X25519 ephemeral keypair, derives a shared secret with the recipient, applies HKDF with info label `SovereignS3nc-DM-v3-ephemeral`, then **zeroes the ephemeral secret key from memory** in a `finally` block.
  - Added `deriveRecipientSharedSecret(ephemeralPublicKey)` — recipient-side mirror using their static identity private key.
  - `sendDirectMessage()` and `_saveAndSendDM()` in `MessagingModule` now use v3 ephemeral keying by default. The ephemeral public key is stored alongside the ciphertext in the `ephemeral_pk` column.
  - `getInboxMessages()` decrypts with a three-tier fallback: v3 (ephemeral) → v2 (static HKDF) → v1 (raw legacy), ensuring zero data loss during upgrades.
  - **Why**: Every message now uses a fresh DH secret, so compromise of a long-term identity key does not reveal past message content.

### Feature — Multi-Device Key Synchronisation

- **`createDevicePairingPackage(passphrase, validityMs)`** (`SovereignS3nc.ts`)
  - Generates a time-limited (default: 5 minutes) AES-256-GCM encrypted payload containing the user's identity keypair, userId, appId, and password, encrypted with a PBKDF2-derived passphrase key (50,000 iterations).
  - Encodes to a Base64 string safe for QR code, P2P channel, or manual copy-paste transfer.

- **`importDevicePairingPackage(code, passphrase)`** (`SovereignS3nc.ts`)
  - Validates expiry, decrypts with the passphrase, and restores identity keys on the receiving device.
  - Throws `AuthError` on incorrect passphrase, expired package, or tampered data.

- **Device Registry** (`SovereignS3nc.ts`, `types.ts`)
  - `registerDevice(deviceName)` — registers a named device entry with status `active`.
  - `revokeDevice(deviceId)` — marks a device as `revoked` without deleting its audit trail.
  - `getRegisteredDevices()` — retrieves the full device registry from private storage.
  - `DeviceInfo` and `DevicePairingPackage` types exported from `src/types.ts`.

### Feature — Message Expiration & TTL

- **Per-message TTL via `expiresAt`** (`Messaging.ts`, `Feed.ts`)
  - `sendDirectMessage(recipientId, content, image?, expiresAt?)` accepts an optional Unix-ms expiry timestamp.
  - `getInboxMessages()` silently skips messages where `expiresAt <= Date.now()`, preventing stale messages from appearing in the UI.
  - `cleanupExpired(dates?)` — explicitly deletes expired messages from outbox SQLite partitions and runs `VACUUM`.
  - `compactDatabase(date?, force?)` — tombstone-ratio-aware compaction (purges `isDeleted` + expired rows when ratio ≥ 50%).
  - Identical TTL support added to `FeedModule.post()` and `FeedModule.cleanupExpired()`.

### Feature — Read Receipts & Delivery Status (End-to-End)

- **Receipt schema and APIs** (`Messaging.ts`)
  - SQLite migration v2 adds `status TEXT` column to `messages` table.
  - SQLite migration v3 adds `expiresAt INTEGER` column.
  - `markAsRead(senderId, messageId, date)` — writes a `read` receipt to `public/modules/messaging/receipts/{senderId}/{date}.db`.
  - `markAsDelivered(senderId, messageId, date)` — writes a `delivered` receipt, skipping if already `read`.
  - `markBatchAsRead()` / `markBatchAsDelivered()` — batch variants for efficiency.
  - `getMessageReceipt(messageId, date)` — reads current status from the outbox SQLite.

- **Automatic receipt acquisition in `getInboxMessages()`**
  - When loading messages, new messages for each followed user automatically call `markBatchAsDelivered()`, causing a receipt DB to be written to local public storage.
  - Pulled receipts from followed users update outbox `status` column in a single UPDATE that respects status promotion ordering (`sent → delivered → read`).

- **Manifest-driven receipt sync** (`ManifestManager.ts`, `SyncOrchestrator.ts`, `types.ts`)
  - `SovereignManifest` and `SubManifest` now include a `receipts?: Record<string, string[]>` field (senderId → date list).
  - `ManifestManager.generateHierarchicalManifest()` detects `public/modules/{module}/receipts/{senderId}/{date}.db` paths and indexes them under `manifest.receipts[senderId]`.
  - `SyncOrchestrator.syncFollowedUser()` now explicitly pulls receipt files for the current user from each followed user's public store, using both the manifest-driven path (when a manifest is present) and a date-range fallback (when no manifest is available).
  - This closes the end-to-end loop: Bob marks Alice's messages as read → Bob's public receipt DB is uploaded → Alice syncs Bob → Alice's outbox shows `read` status.

### Changed

- `SovereignS3nc.VERSION` bumped to `3.2.0`.
- `package.json` version bumped to `3.2.0`.

### Build & CI

- GitHub Actions workflow (`ci.yml`, `deploy-demos.yml`) updated to Node 22 to align with engine requirements of transitive dependencies (`jsdom`, `undici`).
- `.npmrc` with `legacy-peer-deps=true` added to prevent npm 10+ peer-dep resolution failures in CI.
- `package.json` overrides added for `@docsearch/react` React-version peer dependency.
- `DemoDeployment.unit.test.ts` build condition hardened: triggers rebuild if `dist/index.html` is absent inside an otherwise-existing `demo-dist/` directory.

### Tests

- `tests/Messaging.unit.test.ts`: tests for ephemeral forward secrecy (v3 ECDH), `markAsRead/Delivered`, `getMessageReceipt`, `expiresAt` filtering, and cross-user shared-secret derivation.
- `tests/SovereignS3nc_Extra.unit.test.ts`: tests for Multi-Device Pairing, Device Registry (register/revoke), HKDF shared secret symmetry.
- All 274+ unit tests passing.

---

## [3.1.0] — 2026-09-16

### Added

- Feed Module: public posting with nested comments, likes, image attachments, edit & delete.
- Messaging Module: end-to-end encrypted direct messaging with image support, edit & delete.
- Profile Module: profile picture uploads with automatic compression and ETag-based sync.
- WebRTC Gossip Layer: peer-to-peer data sync via gossip protocol.
- QR Pairing: `enableP2PPairing` config option with BLE/QR signalling transport.
- VitePress documentation site with full API reference.
- React package (`@sovereigns3nc/react`) with typed hooks.
- Repository typed abstraction over daily-partitioned SQLite stores.
- Hierarchical manifest with Merkle root for efficient diffing.
- Group management: create, join, leave, role assignment, permission control.
- Moderation engine with admin E2EE report channel.
- Data retention policy (`retentionPolicy.maxDaysOwnData`, `maxDaysFollowedData`).
- Performance audit integration in CI.
- Dependabot CVE patches.
- PWA manifest + service worker support in the Social demo.

---

## [3.0.0] — Initial public release

- Core offline-first sync engine with IndexedDB and S3 backends.
- Symmetric AES-256-GCM encryption for private files.
- PBKDF2-V2 password-based key derivation with migration from legacy 1000-iteration keys.
- Global user registry (`users.json`) for public-key discovery and social graph.
- Follow/unfollow with automatic background sync of followed users' public data.
