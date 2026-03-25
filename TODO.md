# SovereignS3nc TODO

## 🏗️ Refactoring & Architecture (High Priority)
- [x] **Utility Extraction: `MediaUtils`**
    - [x] Move `compressImage` from `SocialManager` to `src/utils/MediaUtils.ts`.
    - [x] Add environment gating for DOM-dependent code (Browser vs Node).
- [x] **Core: Group Store Orchestration**
    - [x] Implement `db.getGroupStore(groupId, schema)` in `SovereignS3nc`.
    - [x] Migrate `SocialManager.getDb` group logic to core (decryption + schema application).
- [ ] **Core: P2P Messaging Primitive**
    - [x] Implement `db.sendEncryptedPayload(recipientId, payload, namespace)` in `SovereignS3nc`.
    - [ ] Move "Outbox + Encrypted Public Inbox" logic from `SocialManager._saveAndSendDM`.
- [ ] **Core: Identity Discovery Lifecycle**
    - [ ] Integrate `syncOtherProfiles` logic into `SovereignS3nc.sync()` or a new `db.discover()`.
    - [ ] Automate ETag-based background checking for `user.json` across followed users.
- [ ] **Core: Privacy & Data Protection**
    - [ ] Implement library-level derivation of "unfindable" hashed backend paths using a combination of username and password to prevent public enumeration of user storage.
    - [ ] Implement a mechanism to check whether a user already exists based on their username (e.g., via a hashed username registry) even when the private profile is stored at an unfindable hashed path.
    - [ ] Implement a library-level safety mechanism to prevent a valid existing user's local or remote data from being accidentally overridden during login/registration.
- [x] **Storage: SQLite Node Adapter & Server**
    - [x] Create a `SQLiteNodeStorage` adapter that stores all files/metadata in a single consolidated SQLite database.
    - [x] Build a Node.js server to support the social network using this storage backend.
- [x] Modules: Granular Decomposition
    - [x] Create `src/modules/Profile.ts` for identity, `user.json`, and follow-graph management.
    - [x] Create `src/modules/Messaging.ts` for E2EE DM workflows (using core primitives).
    - [x] Create `src/modules/Feed.ts` for posts, comments, and distributed likes aggregation.
    - [x] Reduce `src/modules/Social.ts` to a thin composite wrapper and mark as @deprecated.
    - [x] Replace all `SocialManager` usage in CLI, Server, and Demos with granular modules.
- [x] **Demos: Alignment**
    - [x] Update Social Demo to use granular modules (`Feed`, `Messaging`, `Profile`).
    - [x] Update Banky Demo to use `ProfileModule` for identity, ensuring zero dependency on Social logic.

## 🚀 Features & Enhancements
- [ ] **Security & Auth**
    - [ ] Add multi-user integration test for messaging.
    - [ ] Implement offline login (verify against local `public/user.json` / cached private UUID).
    - [ ] Fail login early if password results in incorrect private key derivation.
    - [ ] Add "Change Password" flow (re-encrypting data or migrating to new profile prefix).
- [ ] **Performance & UX**
    - [ ] Use background Web Workers for data fetching/sync to prevent UI stutter.
    - [ ] Implement PWA support for local installation.
    - [ ] Optimize request/data usage (batching S3 operations).
    - [ ] Audit library performance and provide recommendations.
- [ ] **Accessibility & UI**
    - [ ] Mobile-friendly responsive audit for Social Demo.
    - [ ] Create a "Read Only" static export of user profiles and public posts.

## 🛠️ Tooling & DX
- [ ] **Admin CLI**
    - [ ] Implement `list` commands for S3 visibility.
    - [ ] Add password reset/migration capabilities for admins.
    - [ ] Backup/Restore/Clear database commands.
- [ ] **Developer Experience**
    - [ ] Write a Gemini CLI Skill for the library.
    - [ ] Add a multi-user integration test for messaging.

---

## ✅ DONE
- [x] Remove FB Clone mentions and branding.
- [x] Connection status icon with manual toggle/back-off logic.
- [x] Post/Message editing with "Edited" flags.
- [x] Post/Message deletion (tombstoning/content removal).
- [x] Image support in posts and DMs (including image-only items).
- [x] UI: Reset file selection after upload.
- [x] Updated README.md and GEMINI.md with new architecture details.
- [x] Implement Debug flags and reduce console noise.
- [x] User CLI for account management, profiles, DMs, and feed interactions.
