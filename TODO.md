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
- [ ] **Core: Sync Optimization**
    - [ ] Parallelize S3 operations in `sync()` using `Promise.all` for improved performance.
    - [ ] Implement a remote `manifest.json` for "one-shot" diffing of the entire remote state.
- [ ] **WebRTC: Gossip Scaling**
    - [ ] Optimize gossip protocol for larger networks (e.g., DHT-lite or neighbor-limited broadcasts).
- [x] Modules: Granular Decomposition
    - [x] Create `src/modules/Profile.ts`, `src/modules/Messaging.ts`, `src/modules/Feed.ts`.
    - [x] Reduce `src/modules/Social.ts` to a thin composite wrapper.
    - [x] Replace all `SocialManager` usage in CLI, Server, and Demos.

## 🚀 Features & Enhancements
- [x] **Security & Auth**
    - [x] Add multi-user integration test for messaging.
    - [x] Implement offline login (verify against local `private/sentinel.enc`).
    - [x] Fail login early if password results in incorrect private key derivation.
    - [x] Implement `changePassword` core logic (data migration and re-encryption).
    - [ ] **UI**: Add "Change Password" flow to Social and Banky demo apps.
- [ ] **Performance & UX**
    - [x] Implement background Web Workers for sync.
    - [ ] Make Web Workers the default seamless experience in demos (currently opt-in).
    - [ ] Implement PWA support (`manifest.json` + Service Worker) for local installation.
    - [ ] Audit library performance and provide benchmarks for sync latency and storage overhead.
- [ ] **Accessibility & UI**
    - [ ] Mobile-friendly responsive audit for Social Demo.
    - [x] Create a "Read Only" static export of user profiles and public posts.
    - [ ] Implement a Conflict Resolution UI for modules to handle concurrent edits.

## 🧪 Testing & Validation
- [ ] **Integration Testing**
    - [ ] Implement real WebRTC/PeerJS integration tests with a live signaling server.
    - [ ] Fix and re-enable the messaging portion of `tests/multi_user_browser.spec.ts`.
    - [ ] Create a shared test suite for `IStorage` implementations to ensure behavioral consistency.
- [ ] **Admin & Moderation**
    - [ ] Add integration tests for the Admin CLI with a real S3-compatible backend (RustFS).

## 📚 Documentation & Infrastructure
- [ ] **Security & Whitepaper**
    - [ ] Create a security whitepaper detailing cryptographic primitives, threat models, and metadata privacy.
- [ ] **Deployment & DX**
    - [ ] Write a "Deployment Guide" for generic S3 providers (MinIO, R2, DigitalOcean).
    - [ ] Create one-click setup templates (Terraform or Docker Compose) for production-ready RustFS/PeerJS.
    - [x] Write a Gemini CLI Skill for the library.
    - [x] Add comprehensive module unit tests.

---

## ✅ DONE
- [x] Remove FB Clone mentions and branding.
- [x] Connection status icon with manual toggle/back-off logic.
- [x] Post/Message editing with "Edited" flags.
- [x] Post/Message deletion (tombstoning/content removal).
- [x] Image support in posts and DMs.
- [x] UI: Reset file selection after upload.
- [x] Updated README.md and GEMINI.md with new architecture details.
- [x] Implement Debug flags and reduce console noise.
- [x] User CLI for account management, profiles, DMs, and feed interactions.
- [x] Organize documentation into `docs/` folder.
- [x] Move testing configurations to `tests/` folder.
- [x] Purge large binaries from Git history and exclude `bin/` from repo.
- [x] Update Social and Banky demos to use granular modules.
