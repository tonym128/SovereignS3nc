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
