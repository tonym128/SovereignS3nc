# SovereignS3nc Parallel Worktrees

This file tracks active development tasks being processed by independent subagents.

| ID | Task | Target File(s) | Status |
| :--- | :--- | :--- | :--- |
| WT-1 | **Sync Parallelization** | `src/SovereignS3nc.ts` | Completed |
| WT-2 | **Change Password UI** | `demo/social/src/App.tsx` | Completed |
| WT-3 | **IStorage Test Suite** | `tests/StorageConsistency.test.ts` | Completed |
| WT-4 | **Deployment Guide** | `docs/deployment.md` | Completed |
| WT-5 | **WebRTC Scaling** | `src/adapters/WebRTCRemoteAdapter.ts` | Completed |

## Completed Objectives

### WT-1: Sync Parallelization
- Refactored `sync()` to use parallelized `Promise.all` calls.
- Implemented a `runBatched` helper to limit concurrency (max 10) to prevent overwhelming the connection.

### WT-2: Change Password UI
- Added a "Security" section to the Social Demo profile view.
- Implemented `handleChangePassword` form with validation and success/error handling.
- Integrated `localStorage` updates for the new password.

### WT-3: IStorage Test Suite
- Created `tests/StorageConsistency.test.ts` with 27 shared test cases.
- Standardized path sanitization across `IndexedDBStorage`, `NodeStorage`, and `SQLiteNodeStorage` to prevent directory traversal.
- Verified parity for CRUD, listing, and metadata.

### WT-4: Deployment Guide
- Created `docs/deployment.md` with specific guides for MinIO, Cloudflare R2, and DigitalOcean Spaces.
- Documented CORS requirements, ETag casing, and metadata limits.

### WT-5: WebRTC Scaling
- Implemented Message TTL (hop limits) and a deduplication cache.
- Added a `maxPeers` limit (default 5) to the `WebRTCRemoteAdapter`.
- Updated UI and tests to handle peer connection limits gracefully.
