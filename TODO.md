# SovereignS3nc TODO

## 🏗️ Refactoring & Architecture (High Priority)
- [x] **Utility Extraction: `MediaUtils`**
    - [x] Move `compressImage` from `SocialManager` to `src/utils/MediaUtils.ts`.
    - [x] Add environment gating for DOM-dependent code (Browser vs Node).
- [x] **Core: Group Store Orchestration**
    - [x] Implement `db.getGroupStore(groupId, schema)` in `SovereignS3nc`.
    - [x] Migrate `SocialManager.getDb` group logic to core (decryption + schema application).
- [x] **Core: P2P Messaging Primitive**
    - [x] Implement `db.sendEncryptedPayload(recipientId, payload, namespace)` in `SovereignS3nc`.
    - [x] Move "Outbox + Encrypted Public Inbox" logic from `SocialManager._saveAndSendDM`.
- [x] **Core: Identity Discovery Lifecycle**
    - [x] Integrate `syncOtherProfiles` logic into `SovereignS3nc.sync()` or a new `db.discover()`.
    - [x] Automate ETag-based background checking for `user.json` across followed users.
- [x] **Core: Privacy & Data Protection**
    - [x] Implement library-level derivation of "unfindable" hashed backend paths.
    - [x] Implement username existence check via hashed registry.
    - [x] Implement safety mechanism to prevent data override during login.
- [x] **Storage: SQLite Node Adapter & Server**
    - [x] Create a `SQLiteNodeStorage` adapter.
    - [x] Build a Node.js server using this backend.
- [x] **Core: Sync Optimization**
    - [x] Parallelize S3 operations in `sync()` using `Promise.all` for improved performance.
    - [x] Implement a remote `manifest.json` for "one-shot" diffing of the entire remote state.
- [x] **WebRTC: Gossip Scaling**
    - [x] Optimize gossip protocol for larger networks (e.g., DHT-lite or neighbor-limited broadcasts).
- [x] Modules: Granular Decomposition
    - [x] Create `src/modules/Profile.ts`, `src/modules/Messaging.ts`, `src/modules/Feed.ts`.
    - [x] Reduce `src/modules/Social.ts` to a thin composite wrapper.
    - [x] Replace all `SocialManager` usage in CLI, Server, and Demos.
- [x] Ergonomics & Initialization
    - [x] Constructor Refactoring: Implement a static factory method `SovereignS3nc.create(...)` to eliminate the need for an explicit `init()` call.
    - [x] MediaUtils Cleanup: Replace temporary `console.log` debug statements with the project's internal `Logger`.


## 🚀 Features & Enhancements
- [x] **Security & Auth**
    - [x] Add multi-user integration test for messaging.
    - [x] Implement offline login (verify against local `private/sentinel.enc`).
    - [x] Fail login early if password results in incorrect private key derivation.
    - [x] Implement `changePassword` core logic (data migration and re-encryption).
    - [x] **UI**: Add "Change Password" flow to Social and Banky demo apps.
- [x] **Performance & UX**
    - [x] Implement background Web Workers for sync.
    - [x] Make Web Workers the default seamless experience in demos (currently opt-in).
    - [x] Implement PWA support (`manifest.json` + Service Worker) for local installation.
    - [x] Audit library performance and provide benchmarks for sync latency and storage overhead.
    - [x] **Error Resilience**: Added exponential backoff for S3 operations and smarter handling of `AbortController` timeouts.
- [x] **Accessibility & UI**
    - [x] Mobile-friendly responsive audit for Social Demo.
    - [x] Create a "Read Only" static export of user profiles and public posts.
    - [x] **UI Implementation**: Add "Export Static Website" button to the Social Demo profile screen to trigger the static export process.
    - [x] Implement a Conflict Resolution UI for modules to handle concurrent edits.
    - [x] **UI Implementation**: Add Conflict Resolution UI to Social and Banky demos to expose the `pendingConflicts` mechanism to users.
- [x] Implement Node.js-native image compression fallback in MediaUtils (e.g., using sharp or jimp).
- [x] **PWA & Offline**
    - [x] **Native WebRTC Transport**: Implemented `NativeWebRTCTransport` for serverless signaling (QR/Bluetooth foundation).
    - [x] **QR Pairing UI**: Integrated QR generation and scanning into the Social Demo for 100% serverless, off-grid pairing.
    - [x] **Web Bluetooth (Central)**: Added browser-side BLE scanning for pairing with headless/native peripherals.
    - [x] **Peer Exchange (PEX)**: Implemented automated in-band signaling and peer discovery through existing connections.
    - [x] **PWA Audit & Fix**: Comprehensive caching for `sync-worker.js`, CDN assets, and SQL.js WASM; added iOS meta tags and "Offline" UI indicators.
    - [x] Add `screenshots` array to `manifest.json` (requires 1280x720 and 540x720 images).
    - [x] Audit and implement advanced offline caching strategies for media blobs and SQLite fragments.

## 🧪 Testing & Validation
- [x] **Integration Testing**
    - [x] Implement real WebRTC/PeerJS integration tests with a live signaling server.
    - [x] Fix and re-enable the messaging portion of `tests/multi_user_browser.spec.ts`.
    - [x] Create a shared test suite for `IStorage` implementations to ensure behavioral consistency.
- [x] **Admin & Moderation**
    - [x] Add integration tests for the Admin CLI with a real S3-compatible backend (RustFS).
- [x] Integrate `perf-audit.ts` benchmarking into the CI pipeline to prevent sync latency regressions.
- [x] Add integration tests for complex group permissions and member removal/revocation edge cases.
- [x] **Storage Migration Tests**: Verify data consistency and integrity when switching between `IndexedDBStorage` and `SQLiteNodeStorage`.

## 📚 Documentation & Infrastructure
- [x] **Security & Whitepaper**
    - [x] Create a security whitepaper detailing cryptographic primitives, threat models, and metadata privacy.
    - [x] **Formal Whitepaper**: Formalize security documentation into a full whitepaper with formal threat modeling and cryptographic proofs.
- [x] **Deployment & DX**
    - [x] Write a "Deployment Guide" for generic S3 providers (MinIO, R2, DigitalOcean).
    - [x] **Provider Recipes**: Add specific configuration "recipes" for Cloudflare R2 and Backblaze B2 (ETag/CORS specificities).
    - [x] Create one-click setup templates (Terraform or Docker Compose) for production-ready RustFS/PeerJS.
    - [x] **Cloud-Native Templates**: Create Helm charts or Terraform modules for scaling in Kubernetes and serverless environments.
    - [x] Write a Gemini CLI Skill for the library.
    - [x] Modern Packaging: Implemented ESM/CJS dual-loading in `package.json`.
    - [x] Create `AGENT.md` for AI Agent context and include it in the npm package.
    - [x] Add comprehensive module unit tests.
    - [x] Remove npm publish from GitHub Workflows.

## User Generated TODO's
- [x] Users should always check for and recieve admin messages requesting actions, even if they're not following the admins posts.
- [x] When a admin deletes a post, it deletes the entire day, but the user re-uploads on their next upload without deleting the post from their store. Put a mechanism in place for the user to delete that post and reupload their data (E2EE message forcing a delete)
- [x] If an admin sends a E2EE user message for action, the message should be displayed with formatting to indicate what action the admin took on them.

---

## ✅ DONE
- [x] Remove FB Clone mentions and branding.
- [x] Connection status icon with manual toggle/back-off logic.
- [x] Post/Message editing with "Edited" flags.
- [x] Post/Message deletion (tombstoning/content removal).
- [x] Image support in posts and DMs.
- [x] UI: Reset file selection after upload.
- [x] Updated README.md and GEMINI.md with new architecture details.
- [x] Refactored documentation into `docs/api.md` with full config and module reference.
- [x] Created `AGENT.md` for AI-agent-specific technical onboarding.
- [x] Implemented `SovereignS3nc.create()` static factory for improved ergonomics.
- [x] Standardized `package.json` with modern `exports` and `files` packaging.
- [x] Implement Debug flags and reduce console noise.
- [x] User CLI for account management, profiles, DMs, and feed interactions.
- [x] Organize documentation into `docs/` folder.
- [x] Move testing configurations to `tests/` folder.
- [x] Purge large binaries from Git history and exclude `bin/` from repo.
- [x] Update Social and Banky demos to use granular modules.

---

## 🎯 Post-Review Strategic Roadmap Tasks (2026)

### 🧪 1. Testing & Edge-Case Verification

- [x] **Timezone & Midnight UTC Boundary Rollover Tests**
  - **Target File(s)**: `tests/TimezoneRollover.unit.test.ts`, `src/modules/Messaging.ts`, `src/modules/Feed.ts`, `src/SovereignS3nc.ts`
  - **Context**: SovereignS3nc partitions data into daily SQLite databases using ISO date strings derived from UTC (`new Date().toISOString().split('T')[0]`). When two users communicate across drastic timezone differences (e.g. UTC+13 New Zealand vs UTC-10 Hawaii), or send messages within seconds of 23:59:59 UTC, message timestamps and partitioned database file paths may span different calendar dates.
  - **Expectations & Acceptance Criteria**:
    - Add a dedicated test suite `tests/TimezoneRollover.unit.test.ts`.
    - Simulate User A in timezone UTC+13 writing messages at 23:59:59 UTC, and User B in UTC-10 querying inbox within the standard day-window (`getInboxMessages(days)`).
    - Validate that messages sent on day boundary are discovered, decrypted, and sorted accurately by timestamp regardless of local system timezone.
    - Validate that `FeedModule` post queries consistently surface posts published during midnight rollover without off-by-one date partition omissions.

- [ ] **Network Degradation & Chaos Testing for WebRTC Mesh**
  - **Target File(s)**: `tests/WebRTC_Chaos.integration.ts`, `src/adapters/WebRTCRemoteAdapter.ts`
  - **Context**: In WT-37, token-bucket rate limiting (20 msg/sec burst) and signed message TTLs (30s) were added to prevent gossip flooding. However, real-world peer-to-peer networks suffer from packet loss (5-20%), variable latency jitter (100-500ms), and rapid peer churn (disconnect/reconnect loops).
  - **Expectations & Acceptance Criteria**:
    - Implement an automated integration test with simulated network transport delay and drop rate.
    - Validate that `WebRTCRemoteAdapter` handles packet drops without deadlocking or dropping queued sync tasks.
    - Verify that reconnect exponential backoff prevents CPU spikes when signaling or peer channels drop repeatedly.
    - Confirm gossip loop termination: Ensure that re-broadcasted messages are dropped after hop TTL or 30s without propagating endlessly.

- [ ] **SQLite File Fragmentation & Compaction Stress Test**
  - **Target File(s)**: `tests/SQLiteCompaction.unit.test.ts`, `src/core/SyncOrchestrator.ts`, `src/modules/Messaging.ts`
  - **Context**: SQLite databases in `sql.js` grow as messages and posts are inserted and marked as deleted/tombstoned. In browser environments, IndexedDB storage quotas are finite. Without periodic compaction (`VACUUM`), databases will retain unused allocated pages.
  - **Expectations & Acceptance Criteria**:
    - Write a stress test simulating 90 days of message insertions, deletions, and TTL expirations.
    - Measure database export byte sizes before and after `VACUUM`.
    - Add an optional auto-compaction pass in `cleanupExpired()` when deleted record counts exceed a threshold (e.g., >50 rows deleted).
    - Ensure WASM memory is freed after database closure and export.

---

### 🏗️ 2. System Design & Architecture

- [ ] **Browser Storage Eviction Protection (`navigator.storage.persist`)**
  - **Target File(s)**: `src/adapters/IndexedDBStorage.ts`, `src/SovereignS3nc.ts`, `src/types.ts`
  - **Context**: Modern mobile browsers (particularly Safari WebKit and Chromium on low-storage devices) automatically evict IndexedDB databases if storage pressure occurs or after 7 days of inactivity in non-installed web apps unless persistent storage is explicitly requested via the Web Storage API.
  - **Expectations & Acceptance Criteria**:
    - In `IndexedDBStorage.init()`, check if `navigator?.storage?.persist` is available.
    - If available and not already persistent (`navigator.storage.persisted() === false`), request persistence.
    - Expose `getStoragePersistenceStatus(): Promise<{ persisted: boolean, quota?: number, usage?: number }>` on `IStorage` and `SovereignS3nc`.
    - Add unit tests mocking `navigator.storage` to verify both granted and denied persistence states without throwing errors in Node.js environments.

- [ ] **S3 Resumable Multipart Uploads for Large Media Blobs (>25MB)**
  - **Target File(s)**: `src/adapters/S3RemoteAdapter.ts`, `src/interfaces/IRemoteAdapter.ts`
  - **Context**: Currently, `saveBlob()` uploads images and files as a single S3 `PutObjectCommand`. For media blobs larger than 25MB (e.g. video files, audio attachments, or large database exports), network interruptions on mobile connections cause total upload failure requiring a restart from 0%.
  - **Expectations & Acceptance Criteria**:
    - Add threshold configuration `multipartChunkSize?: number` (default 5MB) and `multipartThreshold?: number` (default 25MB) to `S3Config`.
    - When uploading payloads > `multipartThreshold`, use `CreateMultipartUploadCommand`, upload 5MB chunks via `UploadPartCommand`, and finalize with `CompleteMultipartUploadCommand`.
    - Implement retry with exponential backoff on individual part failures.
    - Provide unit tests mocking AWS SDK multipart commands and error recovery.

- [ ] **Aggregated Follow-Manifest Diffing (S3 ETag Request Optimization)**
  - **Target File(s)**: `src/core/SyncOrchestrator.ts`, `src/core/ManifestManager.ts`
  - **Context**: When a user follows 50+ users, checking remote day-partition updates across recent days performs dozens of individual `HEAD` and `GET` requests to S3 per sync interval. This can result in request amplification and rate limits on some S3 providers.
  - **Expectations & Acceptance Criteria**:
    - Enable followed users' manifests to be queried in a batch or check against a lightweight user-level sync timestamp.
    - Cache positive ETag matches with TTL so unchanged remote users are skipped without network calls during short auto-sync cycles.
    - Add a benchmark test demonstrating reduced HTTP request counts when syncing with 20 followed users.

- [ ] **Hierarchical Merkle Tree Manifests for Large Repositories (>10k Files)**
  - **Target File(s)**: `src/core/ManifestManager.ts`
  - **Context**: `manifest.json` currently maintains a flat key-value list of all files in the account. When accounts accumulate tens of thousands of date partitions, media blobs, and group stores over multiple years, serializing and downloading a single flat JSON manifest becomes a memory bottleneck.
  - **Expectations & Acceptance Criteria**:
    - Implement support for hierarchical manifests partitioned by year or namespace (`manifests/YYYY.json`, `manifests/blobs.json`).
    - Compute top-level Merkle root hash for the account manifest to detect whether any sub-manifest has changed in a single 1KB fetch.
    - Ensure 100% backward compatibility: detect and parse flat `manifest.json` for existing users and migrate seamlessly.

---

### 💻 3. Engineering & Developer Experience (DX)

- [ ] **Lightweight Typed Repository Layer (`getRepository<T>`)**
  - **Target File(s)**: `src/core/Repository.ts`, `src/SovereignS3nc.ts`, `src/index.ts`
  - **Context**: Custom modules must currently write raw SQL strings against SQLite instances. This introduces typo risks and lacks TypeScript auto-completion for schema types.
  - **Expectations & Acceptance Criteria**:
    - Create a generic `Repository<T>` class supporting type-safe CRUD operations:
      - `find(query: Partial<T>): Promise<T[]>`
      - `findById(id: string): Promise<T | null>`
      - `insert(entity: T): Promise<void>`
      - `update(id: string, updates: Partial<T>): Promise<void>`
      - `delete(id: string): Promise<void>`
    - Expose `db.getRepository<T>(moduleName, tableName, datePartition?)` on `SovereignS3nc`.
    - Validate with unit tests demonstrating full type safety and SQL injection protection.

- [ ] **Official `@sovereigns3nc/react` Reactive Hooks Package**
  - **Target File(s)**: `packages/react/package.json`, `packages/react/src/useSovereign.ts`, `packages/react/src/useDirectMessages.ts`, `packages/react/src/useFeed.ts`
  - **Context**: Developers building React apps (like the demos) have to manually implement `useEffect`, event listeners for `sync:progress` and module updates, and state synchronization.
  - **Expectations & Acceptance Criteria**:
    - Implement a dedicated React package with standard context provider:
      - `<SovereignProvider config={config}>`
      - `useSovereign(): SovereignS3nc`
      - `useSyncStatus(): { isSyncing: boolean, progress: number, stage: string }`
      - `useDirectMessages(recipientId: string): { messages: Message[], sendDM: (text: string) => Promise<void>, isLoading: boolean }`
      - `useFeed(): { posts: Post[], createPost: (content: string) => Promise<void> }`
    - Include unit tests using `@testing-library/react-hooks` or React test renderer.

- [ ] **Browser DevTools / In-App Visual Storage Inspector**
  - **Target File(s)**: `src/utils/Inspector.ts`, `demo/social/src/components/InspectorModal.tsx`
  - **Context**: Debugging sync conflicts, inspecting encrypted partition files, and diagnosing WebRTC mesh state currently requires digging through raw browser IndexedDB panels and console logs.
  - **Expectations & Acceptance Criteria**:
    - Expose `sov.getDebugSnapshot()` returning:
      - Local storage partition tree and disk footprint.
      - Remote sync status and last ETag cache.
      - Active WebRTC mesh peer IDs, latency, and gossip packet stats.
      - Unresolved conflict queue with semantic diff visualization.
    - Provide an opt-in floating UI widget in demo apps activated via `?debug=inspect`.

---

### 🚀 4. Marketing, Documentation & Production Readiness

- [ ] **Deploy Interactive Public Demo Sandbox (Cloudflare / GitHub Pages)**
  - **Target File(s)**: `.github/workflows/deploy-demos.yml`, `demo/*/build.js`
  - **Context**: Prospective developers and open-source contributors must currently clone the repo, install Node, and execute `dev.sh` to experience the Social, Banky, and Board demos. A zero-friction web URL will drastically improve conversion and adoption.
  - **Expectations & Acceptance Criteria**:
    - Add a GitHub Actions workflow `.github/workflows/deploy-demos.yml` building and deploying demos on push to `master`.
    - Configure demos to connect by default to an ephemeral public demo bucket or in-memory IndexedDB with live P2P WebRTC pairing.
    - Verify responsive layouts and PWA installation on mobile devices from the public URL.

- [ ] **Public Documentation Portal (VitePress or Docusaurus)**
  - **Target File(s)**: `docs/.vitepress/config.ts` or `website/`, `docs/**/*.md`
  - **Context**: The documentation in `docs/` is rich (security whitepaper, deployment recipes, API reference, architecture guide), but flat Markdown files in Git lack search, interactive live code blocks, and visual hierarchy.
  - **Expectations & Acceptance Criteria**:
    - Configure VitePress or Docusaurus in the repository to compile `docs/` into a static site.
    - Implement full-text search, dark/light theme, interactive architecture flowcharts, and runnable code sandbox examples.
    - Include a comprehensive "Why SovereignS3nc vs Supabase / RxDB / Nostr" comparison matrix page.
