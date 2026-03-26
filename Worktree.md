# SovereignS3nc Parallel Worktrees (Batch 5)

| ID | Task | Target File(s) | Status |
| :--- | :--- | :--- | :--- |
| WT-21 | **Remove npm publish from CI** | `.github/workflows/ci.yml` | Completed |
| WT-22 | **Social Demo Mobile Audit** | `demo/social/src/App.tsx` | Completed |
| WT-23 | **Social Demo Mobile Fixes** | `demo/social/src/App.tsx`, `demo/social/index.html` | Completed |
| WT-24 | **Complex Group Permission Tests** | `tests/GroupPermissions.integration.ts` | Completed |
| WT-25 | **Member Revocation Tests** | `tests/MemberRevocation.integration.ts` | Completed |
| WT-26 | **Storage Migration Tests** | `tests/StorageMigration.integration.ts` | Completed |

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
