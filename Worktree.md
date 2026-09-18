# SovereignS3nc Parallel Worktrees (Batch 5)

| ID | Task | Target File(s) | Status |
| :--- | :--- | :--- | :--- |
| WT-21 | **Remove npm publish from CI** | `.github/workflows/ci.yml` | Completed |
| WT-22 | **Social Demo Mobile Audit** | `demo/social/src/App.tsx` | Completed |
| WT-23 | **Social Demo Mobile Fixes** | `demo/social/src/App.tsx`, `demo/social/index.html` | Completed |
| WT-24 | **Complex Group Permission Tests** | `tests/GroupPermissions.integration.ts` | Completed |
| WT-25 | **Member Revocation Tests** | `tests/MemberRevocation.integration.ts` | Completed |
| WT-26 | **Storage Migration Tests** | `tests/StorageMigration.integration.ts` | Completed |
| WT-27 | **Worker Robustness & Error Handling** | `src/worker/SyncWorkerProxy.ts`, `src/SovereignS3nc.ts` | Completed |
| WT-28 | **Security Audit & Package Upgrades** | `package.json`, `src/utils/MediaUtils.ts`, `tests/MediaUtils.unit.test.ts` | Completed |
| WT-29 | **P2P Pairing Feature Flag** | `src/types.ts`, `src/SovereignS3nc.ts`, `demo/social/src/App.tsx`, `demo/social-local/src/AppLocal.tsx` | Completed |
| WT-30 | **WebRTC Release Readiness** | `src/adapters/WebRTCRemoteAdapter.ts`, `src/adapters/NativeWebRTCTransport.ts`, `demo/social/src/App.tsx` | Completed |

## Completed Objectives

### WT-21: Remove npm publish from CI
- Renamed `npm-publish.yml` to `ci.yml`.
- Removed the `npm publish` step to prevent accidental releases.

### WT-22 & WT-23: Social Demo Mobile-friendly Audit & Fixes
- Performed audit and implemented responsive layout fixes.
- Added a mobile-friendly bottom navigation bar.
- Optimized multi-column layouts for single-column mobile view.

### WT-24: Complex Group Permission Tests
- Implemented integration tests in `tests/GroupPermissions.integration.ts`.
- Validated role-based moderation (Owner/Admin delete member posts).
- Verified member access restrictions.

### WT-25: Member Revocation Tests
- Implemented integration tests in `tests/MemberRevocation.integration.ts`.
- Confirmed that removed members are excluded from future sync operations.

### WT-26: Storage Migration Tests
- Implemented `tests/StorageMigration.integration.ts`.
- Validated that data is preserved when switching between `IndexedDBStorage` and `SQLiteNodeStorage` adapters via S3 sync and manual file copying.

### WT-27: Worker Robustness & Error Handling
- Added a 10-second timeout to worker initialization and 60-second timeout for sync operations.
- Fixed unhandled global error when `sync-worker.js` fails to load (async `onerror`).
- Implemented automatic fallback to main-thread sync if the worker fails or times out.
- Added proactive warning and worker disabling for custom adapters (e.g. WebRTC) that cannot be serialized.
- Expanded `tests/SyncWorker.unit.test.ts` to cover these failure modes.

### WT-28: Security Audit & Package Upgrades
- Resolved all moderate and critical vulnerabilities found by `npm audit`.
- Upgraded `jimp` from v0.22 to v1.6.1 (Major Breaking Change).
- Refactored `MediaUtils.ts` and its unit tests to support the new Jimp v1 plugin-based API.
- Upgraded `typescript` to v6.0.3 and `esbuild` to v0.28.0.
- Fixed TypeScript configuration and global types for Web Bluetooth and Jest.
- Validated all 188 unit tests, integration tests, and multi-user browser journeys.

### WT-29: P2P Pairing Feature Flag
- Introduced `enableP2PPairing` flag in `SovereignConfig` to gate Bluetooth and QR pairing.
- Disabled P2P pairing by default in the Social and Social-Local demo applications.
- Enforced the feature flag at the library level in `connectNativeRTC`.
- Added a `?pairing` URL parameter to demos to allow opt-in for testing and advanced users.
- Updated `tests/qr_pairing.spec.ts` to explicitly enable the flag for verification.

### WT-30: WebRTC Release Readiness
- **Mesh Persistence**: Implemented storage-backed seeding in `WebRTCRemoteAdapter`. Nodes now serve files directly from IndexedDB if missing from memory, ensuring data availability after browser refreshes.
- **Reliability**: Integrated OpenRelay public TURN servers into `NativeWebRTCTransport` by default to improve P2P connectivity in restrictive networks (Symmetric NAT).
- **Mesh Dashboard**: Added a new "Mesh" tab to the Social Demo providing real-time visibility into the P2P network, including connected peer counts, unique peer IDs, and a live gossip activity log.
- **Library API**: Exposed `getMeshStats()` in the core `SovereignS3nc` class to allow UI components to query mesh health.

---

# SovereignS3nc Parallel Worktrees (Batch 6)

| ID | Task | Target File(s) | Status |
| :--- | :--- | :--- | :--- |
| WT-31 | **Remove Hardcoded Credentials** | `dev.sh`, `.env.example` | Completed |
| WT-32 | **Enforce TLS for S3 Connections** | `src/adapters/S3RemoteAdapter.ts` | Completed |
| WT-33 | **Signed Global Registry Entries** | `src/discovery/GlobalRegistry.ts` | Completed |
| WT-34 | **HKDF Key Derivation for Shared Secrets** | `src/core/KeyManager.ts`, `src/modules/Messaging.ts` | Completed |
| WT-35 | **CSP Headers for Demo HTML Files** | `demo/*/index.html` | Completed |
| WT-36 | **Encrypted Admin Backups** | `src/admin.ts`, `tests/admin_cli.unit.test.ts` | Completed |
| WT-37 | **Gossip Backpressure & PEX Trust Model** | `src/adapters/WebRTCRemoteAdapter.ts` | Completed |
| WT-38 | **Sync Progress Events & Module Collision Check** | `src/SovereignS3nc.ts`, `src/core/SyncOrchestrator.ts` | Completed |
| WT-39 | **SRI Worker Script Loading Verification** | `src/worker/SyncWorkerProxy.ts`, `src/types.ts` | Completed |
| WT-40 | **Global Registry Write Rate Limiting** | `src/discovery/GlobalRegistry.ts` | Completed |
| WT-41 | **Message & Post Expiration (TTL)** | `src/modules/Messaging.ts`, `src/modules/Feed.ts` | Completed |
| WT-42 | **Read Receipts & Delivery Status** | `src/modules/Messaging.ts` | Completed |
| WT-43 | **Local Data Retention & Cleanup Policy** | `src/core/SyncOrchestrator.ts`, `src/SovereignS3nc.ts` | Completed |
| WT-44 | **Granular Group Permissions** | `src/core/GroupManager.ts`, `src/modules/Feed.ts` | Completed |
| WT-45 | **CI Integration for perf-audit Benchmarks** | `scripts/perf-audit.ts`, `.github/workflows/perf-check.yml` | Completed |
| WT-46 | **Demo App Favicon & Manifest Screenshots** | `demo/*/manifest.json`, `demo/*/favicon.png` | Completed |
| WT-47 | **Security Whitepaper & Threat Modeling** | `docs/security.md` | Completed |
| WT-48 | **Identity Key Rotation & Re-encryption** | `src/core/KeyManager.ts`, `src/SovereignS3nc.ts` | Completed |
| WT-49 | **Multi-device Pairing & Device Registry** | `src/SovereignS3nc.ts`, `src/types.ts` | Completed |
| WT-50 | **Forward Secrecy for Direct Messages** | `src/modules/Messaging.ts`, `src/core/KeyManager.ts` | Completed |

## Completed Objectives (Batch 6)

### WT-31: Remove Hardcoded Credentials
- Parameterized default root key and secret in `dev.sh` to read from environment variables.
- Added comprehensive `.env.example` file.

### WT-32: Enforce TLS for S3 Connections
- Added `requireTLS` option to `S3Config` (defaults to `true`).
- Disallowed plaintext HTTP endpoints in non-development environments.

### WT-33: Signed Global Registry Entries
- Replaced monolithic `users.json` overwrites with signed per-user entries (`users/{userId}.json`).
- Added Ed25519 signature generation and verification with legacy fallback.

### WT-34: HKDF Key Derivation for Shared Secrets
- Applied HKDF-SHA256 expansion on raw X25519 shared secrets with domain separation label `'SovereignS3nc-DM-v2'`.
- Preserved backward compatibility fallback (`'SovereignS3nc-DM-v1-raw'`).

### WT-35: CSP Headers for Demo HTML Files
- Added strict Content-Security-Policy meta tags across all demo apps.

### WT-36: Encrypted Admin Backups
- Encrypted administrative JSON backups using AES-256-GCM and PBKDF2 (`SOV_BACKUP_V1`).

### WT-37: Gossip Backpressure & PEX Trust Model
- Implemented token-bucket rate limiter (20 msg/sec) for WebRTC gossip.
- Restricted PEX updates to directly connected peers or Ed25519-verified signers with 30s message TTL.

### WT-38: Sync Progress Events & Module Collision Check
- Added `sync:progress` lifecycle events across all sync orchestrator stages.
- Added collision check in `registerModule` throwing `ModuleError` on duplicate names.

### WT-39: SRI Worker Script Loading Verification
- Added Subresource Integrity (SRI) digest validation for sync worker script loading.

### WT-40: Global Registry Write Rate Limiting
- Added 5-minute cooldown between registration updates, deduplication checks, and 7-day age validation.

### WT-41: Message & Post Expiration (TTL)
- Added `expiresAt` timestamps, SQLite v3/v2 schema migrations, read-time filtering, and `cleanupExpired()` methods.

### WT-42: Read Receipts & Delivery Status
- Added delivery and read confirmation pipeline with outbox status synchronization.

### WT-43: Local Data Retention & Cleanup Policy
- Implemented configurable retention policy pruning date-partitioned files older than configured limits.

### WT-44: Granular Group Permissions
- Introduced `GroupPermissions` (`canPost`, `canModerate`, `canInvite`) and enforced role permissions.

### WT-45: CI Integration for perf-audit Benchmarks
- Fixed runtime and memory threshold issues in `scripts/perf-audit.ts` and enabled CI workflow.

### WT-46: Demo App Favicon & Manifest Screenshots
- Added genuine 32x32 icons and desktop/mobile screenshots for PWA compliance.

### WT-47: Security Whitepaper & Threat Modeling
- Authored comprehensive cryptographic security whitepaper with STRIDE threat model in `docs/security.md`.

### WT-48: Identity Key Rotation & Re-encryption
- Implemented `rotateIdentityKeys()` with master-key re-encryption, PBKDF2 salt rotation, and registry update.

### WT-49: Multi-device Pairing & Device Registry
- Added password-authenticated encrypted pairing packages and device revocation registry.

### WT-50: Forward Secrecy for Direct Messages
- Implemented ephemeral-static ECDH forward secrecy with per-message ephemeral X25519 keypair negotiation, HKDF expansion, zeroing of ephemeral private keys, and `ephemeral_pk` storage in recipient boxes with backward-compatible fallbacks.

### WT-51: Timezone & Midnight UTC Boundary Rollover Tests
- Added UTC boundary sliding date window querying in `MessagingModule.getInboxMessages` and `FeedModule.getFeedPosts` across UTC yesterday, today, and tomorrow (`i = -1`) to tolerate timezone variance and sender clock skew.
- Created `tests/TimezoneRollover.unit.test.ts` verifying UTC date consistency, cross-midnight message delivery, clock skew resilience, and feed aggregation.

### WT-52: Network Degradation & Chaos Testing for WebRTC Mesh
- Enhanced `WebRTCRemoteAdapter` with automatic download retries with jittered backoff, and peer reconnection scheduling with exponential backoff (`reconnectBackoffBaseMs`, `maxReconnectBackoffMs`).
- Added robust peer disconnection and cleanup handling accepting channel or `userId` string, resetting backoff upon reconnect, and preventing reconnection loops and CPU spikes during peer churn.
- Added `tests/WebRTC_Chaos.integration.ts` verifying packet drops recovery, partition timeouts, exponential backoff progression, hop limit TTL termination, stale message age drops (>30s), and cyclic mesh termination.

### WT-53: SQLite File Fragmentation & Compaction Stress Test
- Implemented `compactDatabase()` in `MessagingModule` and `FeedModule` with automatic and threshold-based (tombstone ratio >= 50%) SQLite page compaction (`VACUUM`).
- Integrated automated `VACUUM` into `cleanupExpired()` across messaging and feed modules to immediately reclaim free pages after TTL expirations.
- Added orchestrated compaction support `SovereignS3nc.compactDatabases()` via `SyncOrchestrator`.
- Created stress test suite `tests/SQLiteCompaction.unit.test.ts` validating structural integrity, queryability, and >= 40% binary reduction under 1,000 post/message stress scenarios.

### WT-54: Browser Storage Eviction Protection (`navigator.storage.persist`)
- Added automated `navigator.storage.persist()` request during `IndexedDBStorage.init()` to prevent mobile browser storage eviction.
- Added `checkStoragePersistence()` on `IndexedDBStorage`, `SQLiteNodeStorage`, `IStorage`, and `SovereignS3nc` returning persisted status, quota, and usage estimates.
- Added graceful fallbacks for Node.js and unsupported environments.
- Created unit tests verifying automated persistence requests, existing persistence detection, quota reporting, and rejection handling.

### WT-55: S3 Resumable Multipart Uploads for Large Media Blobs (>25MB)
- Added `multipartThreshold` (default 25MB) and `multipartChunkSize` (default 5MB) configuration options to `S3Config`.
- Implemented `uploadMultipart` lifecycle with `CreateMultipartUploadCommand`, chunked `UploadPartCommand`s with exponential backoff retries, and `CompleteMultipartUploadCommand`.
- Implemented automatic cleanup using `AbortMultipartUploadCommand` on permanent part failures to prevent orphaned AWS S3 storage costs.
- Added unit tests in `tests/S3RemoteAdapter.unit.test.ts` verifying single put vs multipart thresholding, part chunking, completion payload, and abort error recovery.

### WT-56: Dependabot & Security Vulnerability Remediation
- Remediated High severity CVEs in `brace-expansion`, `browserslist`, and `js-yaml` via dependency overrides in `package.json`.
- Remediated Moderate severity CVEs in `dompurify` (bumped to `^3.4.13`), `qs`, `body-parser`, and `baseline-browser-mapping`.
- Remediated Low severity CVEs in `esbuild` (bumped to `^0.28.2`) and `@babel/core`.
- Fine-tuned SQLite compaction tombstone threshold (`tombstones >= 50 && tombstoneRatio >= 0.5`) in `FeedModule` and `MessagingModule` to preserve single-item soft-deletion tombstones before syncing.
- Verified all 32 test suites (237/237 tests) and full builds pass cleanly.

### WT-57: Aggregated Follow-Manifest Diffing (S3 ETag Request Optimization)
- Added `followManifestCacheTtlMs` to `SovereignConfig` (default 60000ms).
- Enhanced `ManifestManager` with `fetchManifestWithMeta()`, memory and local storage manifest caching, positive ETag conditional requests (`If-None-Match`), and `clearFollowManifestCache()` / `expireFollowManifestCache()`.
- Enhanced `SyncOrchestrator.syncFollowedUsers()` to sync followed users in concurrent batches of 5.
- Implemented unchanged manifest ETag skipping in `SyncOrchestrator`: when remote returns 304 or cached manifest is valid and unchanged, skips checking all module and DM date partition files.
- Added comprehensive benchmark suite `tests/FollowManifestOpt.benchmark.test.ts` demonstrating 100% request elimination for followed users during short auto-sync intervals and > 65% HTTP request reduction on full sync with 20 followed users.

### WT-58: Hierarchical Merkle Tree Manifests for Large Repositories (>10k Files)
- Added `SubManifestRef`, `SubManifest`, and Merkle tree fields (`merkleRoot`, `subManifests`) to `SovereignManifest` in `src/types.ts`.
- Implemented `generateHierarchicalManifest()` partitioning accounts by year (`manifests/YYYY.json`) and media blobs (`manifests/blobs.json`).
- Implemented deterministic `computeMerkleRoot()` calculating the top-level Merkle root hash across all sub-manifests to detect changes in a single 1KB fetch.
- Implemented incremental sub-manifest uploads in `syncManifest()`, only uploading sub-manifests whose hash changed.
- Implemented `resolveSubManifest()` with local caching and `resolveFullManifest()` with 100% backward compatibility for legacy flat manifests.
- Added comprehensive unit tests in `tests/HierarchicalManifest.unit.test.ts` verifying partitioning, incremental upload, Merkle change detection, and legacy manifest support.

### WT-59: Lightweight Typed Repository Layer (`getRepository<T>`)
- Implemented `Repository<T>` in `src/core/Repository.ts` providing type-safe CRUD operations (`find`, `findById`, `insert`, `update`, `delete`, `count`, and `upsert`).
- Added strict SQL identifier validation (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) for table and column names to ensure 100% protection against SQL injection attacks.
- Parameterized all values in queries and mutations via `sql.js` prepared statements.
- Added automatic update notification dispatch (`moduleName:update`) upon write operations.
- Added `RepositoryError` in `src/utils/Errors.ts` and exposed `getRepository<T>()` on `SovereignS3nc`.
- Added comprehensive unit tests in `tests/Repository.unit.test.ts` covering CRUD, upsert, SQL injection validation, and event emission.

### WT-60: Official `@sovereigns3nc/react` Reactive Hooks Package
- Created dedicated React package under `packages/react/` with `package.json`, `tsconfig.json`, and TypeScript definitions.
- Implemented `<SovereignProvider>` supporting existing `instance` or auto-initializing via `config`, tracking `isInitialized` and `initError`.
- Implemented `useSovereign()` returning the active client instance with context-boundary validation.
- Implemented `useSyncStatus()` tracking `isSyncing`, stage, progress percentages, error handling, and manual `sync()` trigger.
- Implemented `useDirectMessages()` managing end-to-end encrypted messaging, automatic conversation filtering, sorting, and `messaging:update`/`sync:progress` reactive reloading.
- Implemented `useFeed()` managing post creation, likes, soft-deletion, and `feed:update`/`sync:progress` reactive reloading.
- Implemented `useRepository<T>()` reactive hook wrapping the typed repository layer with automated query synchronization upon write events.
- Added `getModuleInstance()` and `isSyncing()` helpers on `SovereignS3nc`.
- Added `build:react` script and mapped exports in root `package.json`.
- Created comprehensive unit tests in `tests/ReactHooks.unit.test.ts` verifying all hooks, providers, and lifecycle states (7/7 tests passing).

### WT-61: Browser DevTools / In-App Visual Storage Inspector
- Implemented `Inspector` in `src/utils/Inspector.ts` collecting local storage partition trees, disk footprints (by category: public, private, followed, blobs, databases), remote sync status, and cached ETags.
- Enhanced `WebRTCRemoteAdapter` with real-time metrics (`packetsSent`, `packetsReceived`, `packetsDropped`, `peerLatencies`, and `getMeshStats()`).
- Added unresolved conflict tracking with semantic diff summaries (for SQLite, JSON, text, and binary files) and exposed `sov.getDebugSnapshot()`.
- Implemented interactive in-app visual inspector modal `demo/social/src/components/InspectorModal.tsx` and wired an opt-in floating trigger in `App.tsx` activated via `?debug=inspect`.
- Created unit tests in `tests/Inspector.unit.test.ts` verifying tree construction, diff generation, snapshot assembly, and conflict resolution (7/7 tests passing).
