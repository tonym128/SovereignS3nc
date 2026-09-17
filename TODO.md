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
