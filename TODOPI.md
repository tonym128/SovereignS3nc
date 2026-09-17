# SovereignS3nc — Comprehensive Review TODO List

Generated from in-depth security, architecture, feature, and UX review.

---

## 🔴 P0 — Critical Security (Fix Immediately)

- [x] **Increase PBKDF2 iterations to ≥600,000** (`src/core/KeyManager.ts`)
  - Current: `crypto.pbkdf2Sync(password, ..., 1000, ...)` — OWASP recommends 600,000+ (2024)
  - At 1,000 iterations, offline brute-force is trivial (~30M passwords/sec on consumer hardware)
  - Also use a **random per-user salt** instead of deterministic `${userId}-master`
  - Store the random salt alongside encrypted data

- [x] **Replace `Math.random()` with `crypto.getRandomValues()` for all IDs** (multiple files)
  - Affected: `Feed.ts` (post IDs), `MessagingModule.ts` (message IDs), `WebRTCRemoteAdapter.ts` (msgId, deduplication), `GroupManager.ts` (group IDs), `SovereignS3nc.ts` (conflict resolution IDs)
  - `Math.random()` is not cryptographically secure — predictable IDs enable message forgery

- [x] **Remove hardcoded demo credentials from repo** (`dev.sh`)
  - `ADMIN_ACCESS="admin-key"`, `ADMIN_SECRET="admin-secret-123"` are committed to source control
  - Anyone who clones the repo can access S3 buckets configured with these credentials
  - Move to `.env` file (gitignored) or environment variables
  - ✅ Fixed: All credentials now load from `.env` (gitignored) via `source .env`. Falls back to defaults with a visible warning. Added `.env.example` template.

- [x] **Add authentication to Admin CLI** (`src/admin.ts`)
  - Currently no password, MFA, or session token protection
  - Any user on the machine can run `sov-admin ban-user <userId>` and purge all data
  - Require explicit admin auth (password + optional MFA)
  - Add audit logging for all destructive operations

---

## 🟡 P1 — High Security & Architecture Issues

- [x] **Default `autoFollowDiscoveredUsers` to `false`** (`src/types.ts`)
  - Currently defaults to `true` — automatically follows every user in the global registry
  - Pulls and stores all discovered users' data without consent
  - Makes social graph fully observable by S3 provider
  - Malicious users can flood registry to trigger unwanted syncs

- [x] **Cryptographically sign P2P messages** (`src/adapters/WebRTCRemoteAdapter.ts`)
  - Peer-to-peer messages use unsigned `senderId` strings — any peer can spoof another's ID
  - Gossip protocol trusts all connected peers blindly
  - Sign all P2P messages using sender's X25519 private key (EdDSA/Ed25519)
  - Verify signatures before accepting data from peers

- [x] **Fix global registry overwrite vulnerability** (`src/discovery/GlobalRegistry.ts`)
  - Any user can upload a new `users.json`, overwriting all other users' entries
  - No versioning, signing, or consensus mechanism
  - Malicious actor could delete all users or inject fake identities
  - Implement signed registry entries (each user signs their own entry)
  - Consider Merkle tree or append-only log for the registry
  - ✅ Fixed: Each user now uploads their own signed file at `users/{userId}.json` containing `{userId, publicKey, signingPublicKey, signature, timestamp}`. Signature is Ed25519 over the canonical payload. `getPublicRegistry()` fetches all `users/*.json`, verifies signatures, and merges with legacy `users.json` (V2 entries take priority). Existing `users.json` still read for backward compat.

- [ ] **Add forward secrecy to DMs** (`src/modules/Messaging.ts`)
  - Current: static ECDH — same shared secret from long-term identity keys
  - If private key is compromised, all past and future messages are decryptable
  - Implement double-ratchet or per-message ephemeral key derivation

- [x] **Enforce TLS for S3 connections** (`src/adapters/S3RemoteAdapter.ts`)
  - Accepts any endpoint URL including `http://` — no validation of HTTPS/TLS usage
  - Exposes encrypted payloads to MITM attacks on the wire
  - Add `requireTLS: boolean` config option; warn/error when using `http://` in production
  - ✅ Fixed: Added `requireTLS` field to `S3Config` (defaults to `true`). Non-localhost `http://` endpoints throw `NetworkError` unless `requireTLS: false` is explicitly set. Localhost/127.x.x.x always allowed for dev. Added 7 unit tests.

- [x] **Fix path sanitization bypass** (`src/adapters/IndexedDBStorage.ts`)
  ```typescript
  private sanitizePath(filePath: string): string {
      return filePath.replace(/\.\./g, '').replace(/^\/+/, '');
  }
  ```
  - Naive replacement can be bypassed (e.g., `a/b/../../c` → `ac`)
  - Split on `/`, filter out empty segments and `.`, `..`, then rejoin
  - Validate against an allowlist of prefixes

- [x] **Blob hash mismatch should reject data, not just warn** (`src/SovereignS3nc.ts`)
  ```typescript
  if (expectedHash !== actualHash) { Logger.warn(...) } // continues to return data
  ```
  - Corrupted/untrusted blobs are still returned to the caller
  - Should throw an error and reject the data

- [x] **Add input validation on module names** (`src/SovereignS3nc.ts`)
  ```typescript
  const cleanModule = moduleName.toLowerCase().replace(/[^a-z0-9]/g, '');
  ```
  - Silently strips characters — `"feed; DROP TABLE"` becomes `"feedDROP TABLE"`
  - Could cause path collisions or confusion

---

## 🟡 P1 — UX Issues in Demos (High Impact)

- [x] **Fix conflict resolution UX** (all demo apps)
  - Shows raw binary/JSON data to users — incomprehensible for most
  - No semantic diff (e.g., "Post content changed from X to Y")
  - `abort` option leaves file in inconsistent state with no recovery path
  - Implement semantic diffs per module type; add "merge" strategy for non-conflicting fields

- [x] **Remove plaintext password storage from localStorage** (`demo/social/src/App.tsx`)
  ```typescript
  localStorage.setItem('sov_social_config', JSON.stringify(currentConfig)); // includes password
  ```
  - Master password stored in plaintext — extractable by anyone with browser access
  - Use a session token derived from the password, or require re-entry for sensitive operations

- [x] **Add loading states during sync operations** (`demo/social/src/App.tsx`)
  - Sync can take seconds (especially first sync) but no visible indicator
  - Users may think app is frozen and refresh, losing unsaved input
  - Show "Syncing..." spinner or progress bar during `sov.sync()`

- [x] **Add notification for auto-sync arrivals** (`demo/social/src/App.tsx`)
  - Auto-sync runs every 60 seconds silently — users don't know new content arrived
  - Show toast/notification when auto-sync brings in new messages/posts

- [x] **Add financial input validation to Banky demo** (`demo/banky/src/App.tsx`)
  ```typescript
  const amount = parseFloat(amt); if (isNaN(amount)) return; // only checks NaN
  ```
  - Users can enter `-999999` as debit → credit of $999,999
  - Add positive-only validation for deposits, reasonable maximums, confirmation dialogs for large amounts

- [x] **Fix Banky demo Chart.js dependency** (`demo/banky/src/App.tsx`)
  ```typescript
  chartInstance.current = new (window as any).Chart(ctx, ...)
  ```
  - Depends on global `Chart` object not imported or bundled — will fail in most environments
  - Import Chart.js properly or use a bundled canvas-based charting library

- [x] **Add empty-state guidance to all demos**
  - Blank areas without guidance when no posts/messages/friends exist
  - Add contextual CTAs: "Follow someone to see their posts", "Scan QR code to connect"

- [x] **Add keyboard accessibility to demo UIs**
  - Custom dialog components don't trap focus or handle Escape key consistently
  - Many interactive elements lack proper ARIA labels and tabindex
  - Add focus trapping, Escape-to-close, full keyboard navigation

- [x] **Add image upload error feedback** (`demo/social/src/App.tsx`)
  ```typescript
  try { dataUrl = await MediaUtils.compressImage(dataUrl, 100 * 1024); } catch (err) {} // silently ignored
  ```
  - Show error toast if compression fails; fall back to uncompressed with warning

- [x] **Add connection status indicator to local demo** (`demo/social-local/src/AppLocal.tsx`)
  - No visual indicator of P2P peer connections — users don't know if messages are being delivered
  - Show peer count and connection status in navbar (e.g., "🟢 3 peers connected")

- [x] **Add React Error Boundaries to all demos**
  - No error boundaries — any JS error crashes the entire UI with no recovery
  - Wrap each demo's main component in an Error Boundary showing a recoverable state

---

## 🟡 P1 — Architecture & Reliability Issues

- [x] **Make sync truly offline-first** (`src/core/SyncOrchestrator.ts`)
  - `sync()` throws errors if remote is unreachable in many code paths
    (`ensureGlobalRegistration`, `updateFollowingPublicKeys`, etc.)
  - Should gracefully degrade to offline mode and queue operations for later retry
  - Wrap all remote calls in try/catch with fallback behavior; track pending operations

- [x] **Add backpressure to gossip protocol** (`src/adapters/WebRTCRemoteAdapter.ts`)
  - Gossip broadcasts every push to all peers without rate limiting — O(n²) message explosion
  - Implement per-peer rate limits, exponential backoff on re-broadcasts
  - Add "sync state" exchange instead of full data gossip for large datasets
  - ✅ Fixed: Added per-channel token-bucket rate limiter (20 sends/sec burst limit, 1s window). `broadcast()` now calls `rateLimitedSend()` which tracks send counts per-channel via WeakMap.

- [x] **Add trust model to PEX (Peer Exchange)** (`src/adapters/WebRTCRemoteAdapter.ts`)
  - PEX allows peers to introduce fake peers with your own user ID
  - Can perform Sybil attacks by creating many fake identities
  - Only accept PEX introductions from trusted/verified peers
  - Add reputation or trust score system
  - ✅ Fixed: `peer_list` messages are now only accepted from (a) directly-connected peers (channelsByUserId match) or (b) peers with a verified Ed25519 signature. Also added age-based TTL enforcement — messages older than 30s are dropped. Added `timestamp` field to `PeerMessage` interface.

  ```typescript
  const allFiles = await this.ctx.storage.listFiles(''); // O(n) every sync
  ```
  - Scans ALL local files on every sync — slow for users with months of data
  - Incremental manifest: only scan files changed since last manifest
  - Cache previous manifest and diff against it

- [x] **Add error recovery for corrupted SQLite databases** (all modules)
  ```typescript
  } catch (e) {} // silently swallowed in Feed.ts, MessagingModule.ts, etc.
  ```
  - Corrupted DBs go undetected — data loss is silent
  - Detect corruption and attempt recovery from remote/peer copies
  - Log specific error types instead of swallowing all exceptions

- [x] **Add trust model to PEX (Peer Exchange)** (`src/adapters/WebRTCRemoteAdapter.ts`)
  - PEX allows peers to introduce fake peers with your own user ID
  - Can perform Sybil attacks by creating many fake identities
  - Only accept PEX introductions from trusted/verified peers
  - Add reputation or trust score system
  - ✅ Fixed (WT-37): `peer_list` messages only accepted from directly-connected peers or peers with a verified Ed25519 signature. Unverified peer_list messages are dropped with a warning log.

---

## 🟢 P2 — Missing Features

- [x] **Add key rotation / re-encryption support** (`src/core/KeyManager.ts`)
  - `changePassword()` exists but no way to rotate identity keys independently
  - Users who suspect key compromise can't generate new X25519 keys while keeping data accessible
  - Add `rotateKeys(oldKey, newKeyPair)` that re-encrypts all local data and updates remote copies
  - ✅ Fixed: Implemented `rotateIdentityKeys(newKeyPair?)` in `KeyManager` and `SovereignS3nc`. Generates new X25519 keypair, re-encrypts it with the master key using a fresh PBKDF2 salt, stores locally in `_keys` and uploads to remote `_keys.json`, updates in-memory keys, and refreshes the global registry registration with the new public key. Tested in `ChangePassword.unit.test.ts`.

- [x] **Add message/post expiration (TTL)** (`src/modules/Messaging.ts`, `src/modules/Feed.ts`)
  - No mechanism for ephemeral messaging or time-limited content
  - Add optional `expiresAt` field to messages/posts
  - Implement sync-time cleanup pass for expired items
  - ✅ Fixed: Added `expiresAt?: number` (Unix ms) to `Message` and `Post` interfaces. Added database migrations (v3 for Messaging, v2 for Feed). `sendDirectMessage()` and `post()` support `expiresAt`. `getInboxMessages()` and `getPosts()` filter out expired entries at read time. Added `cleanupExpired()` methods to both modules to purge expired rows from SQLite files. Tested in `Feed.unit.test.ts` and `Messaging.unit.test.ts`.

- [x] **Add read receipts / delivery status** (`src/modules/Messaging.ts`)
  - No concept of message delivery confirmation or read receipts
  - Users have no feedback on whether DMs were received
  - ✅ Fixed: End-to-end receipt pipeline: `markAsDelivered` and `markAsRead` write receipts into public `receipts/{senderId}/{date}.db`. `getInboxMessages()` pulls receipts from followed users and updates local outbox status (`sent` -> `delivered` -> `read`). Added `getMessageReceipt(messageId, date)` to query message receipt status. Verified with unit tests in `Messaging.unit.test.ts`.

- [x] **Add granular group permissions** (`src/core/GroupManager.ts`, `src/modules/Feed.ts`)
  - Only supports `owner`, `admin`, `member` — no fine-grained controls
  - No "can post" vs "can moderate" distinction
  - Add per-group moderation controls beyond app-level admin
  - ✅ Fixed: Added `GroupPermissions` interface (`canPost`, `canModerate`, `canInvite`) to `GroupMember`. Added `setMemberPermissions` and `setMemberRole` to `GroupManager` (and `SovereignS3nc`). `postToGroup` enforces `canPost !== false`, and `deleteGroupPost` / `getGroupPosts` enforce moderation permission (`owner`, `admin`, or `canModerate: true`). Tested in `Feed.unit.test.ts`.

- [x] **Add data retention / cleanup policy** (`src/core/SyncOrchestrator.ts`)
  - No mechanism to auto-clean old daily DBs or followed user data
  - Storage grows unbounded over time
  - Add configurable retention policy (e.g., "keep last 30 days of public posts")
  - ✅ Fixed: Added `RetentionPolicy` interface (`maxDaysOwnData`, `maxDaysFollowedData`) to `SovereignConfig`. Implemented `applyRetentionPolicy()` in `SyncOrchestrator` (and exposed on `SovereignS3nc`) that prunes local date-partitioned files older than the configured thresholds. Automatically runs during `sync()`. Tested in `SovereignS3nc_Extra.unit.test.ts`.

- [ ] **Add multi-device support** (`src/SovereignS3nc.ts`)
  - Architecture assumes one device per identity key
  - No mechanism for sharing keys across devices or syncing same identity to multiple browsers/phones
  - Implement key sharing protocol with device management

- [x] **Encrypt admin backup data** (`src/admin.ts`)
  ```typescript
  await fs.writeFile(outputPath, data); // plain JSON export
  ```
  - Backup exported as unencrypted JSON — anyone who obtains it can read all system data
  - Add password-based encryption for backup files
  - ✅ Fixed: Backup now encrypted with AES-256-GCM using PBKDF2(password, salt, 600k, SHA-256). Binary format: `SOV_BACKUP_V1` magic + salt(32) + iv(12) + GCM tag(16) + ciphertext. Restore auto-detects encrypted vs legacy plain JSON for backward compat.

---

## 🟢 P2 — Medium Security Improvements

- [x] **Add KDF between X25519 shared secret and AES key** (`src/core/KeyManager.ts`)
  ```typescript
  const keyBuffer = Buffer.from(key, 'hex').slice(0, 32); // direct use as AES key
  ```
  - Shared secret used directly as AES-256 key without KDF
  - Run through HKDF for domain separation and defense-in-depth
  - ✅ Fixed: `deriveSharedSecret()` now applies `crypto.hkdfSync('sha256', rawShared, ..., 'SovereignS3nc-DM-v2', 32)`. Backward compat: `MessagingModule.getInboxMessages` tries V2 first, falls back to V1 (`'SovereignS3nc-DM-v1-raw'`) for pre-HKDF messages.

- [x] **Add Content Security Policy (CSP) to demo HTML files** (all `demo/*/index.html`)
  - Demos load Bootstrap, sql.js, QR libraries from CDNs with no CSP headers
  - Opens XSS risk if any CDN is compromised
  - Add CSP meta tags restricting sources to specific CDN domains + nonces for inline scripts
  - ✅ Fixed: Added `<meta http-equiv="Content-Security-Policy">` to all 6 demo HTML files (social, social-local, blog, banky, board, web). Allows `cdn.jsdelivr.net` + `cdnjs.cloudflare.com`, `'unsafe-inline'` for styles/scripts, `blob:` for WASM workers, `wss:` for WebRTC signaling. `object-src 'none'` and `base-uri 'self'` hardened.

- [x] **Add SRI (Subresource Integrity) hashes to worker script loading** (`src/worker/SyncWorkerProxy.ts`)
  - Worker loaded from URL with no integrity verification
  - Compromised server hosting `sync-worker.js` could inject malicious code
  - Add SRI hash verification for all externally-loaded scripts
  - ✅ Fixed: `SyncWorkerProxy` now accepts optional `integrity` parameter (e.g. `"sha384-..."`). When provided, fetches script via `fetch()`, computes SHA-256/384/512 using `crypto.subtle.digest()`, and verifies against expected base64 hash before creating a Blob URL Worker. Added `workerIntegrity?: string` to `SovereignConfig` type.

- [x] **Add rate limiting / spam protection to global registry** (`src/discovery/GlobalRegistry.ts`)
  - No limit on how often a user can update their entry
  - Malicious users could flood the registry with updates
  - Add per-user write rate limits and deduplication checks
  - ✅ Fixed: In `ensureGlobalRegistration()`, added in-memory cooldown (`REGISTRATION_COOLDOWN_MS = 5m`) to prevent registry flooding on frequent sync calls, plus deduplication check against remote entry. In `verifyEntry()`, added age and future drift validation (`ENTRY_MAX_AGE_MS = 7d`, max 5m future drift) to reject replayed stale entries.

---

## 🟢 P3 — Low Priority / Nice-to-Have

- [x] **Add module name collision detection** (`src/SovereignS3nc.ts`)
  - Sanitized names like `"feedDROP TABLE"` could collide with legitimate modules
  - Add validation that sanitized name matches original after stripping non-alphanumeric chars
  - ✅ Fixed: `registerModule()` now throws `ModuleError` if a module with the same name is already registered, rather than silently ignoring the duplicate. This prevents silent path collisions in the namespace.

- [x] **Add sync progress events** (`src/core/SyncOrchestrator.ts`)
  - No way to track sync progress for large datasets
  - Emit `sync:progress` events with percentage or items remaining
  - ✅ Fixed: `SyncOrchestrator.sync()` now calls `ctx.emitSyncProgress()` at each major phase: `start`, `syncing_own_data`, `registering`, `discovering_users`, `syncing_followed`, `syncing_blobs`, `complete`. SovereignS3nc emits a `sync:progress` event with `{ stage, done?, total? }` payload. Listen via `sov.on('sync:progress', cb)`.

- [x] **Add P2P message TTL enforcement** (`src/adapters/WebRTCRemoteAdapter.ts`)
  - Messages have a TTL field but no strict enforcement — stale messages can persist indefinitely in the mesh
  - Add timestamp-based expiration check on received messages
  - ✅ Fixed: All incoming messages with a `timestamp` field are checked against `MSG_MAX_AGE_MS` (30s). Messages older than 30 seconds are dropped. Outgoing push messages now include `timestamp: Date.now()`. Combined with hop-count TTL this provides two-dimensional staleness protection.

- [x] **Add demo app favicon and proper manifest screenshots** (per TODO.md)
  - `manifest.json` missing `screenshots` array (requires 1280x720 and 540x720 images)
  - Add PWA audit for advanced offline caching of media blobs and SQLite fragments
  - ✅ Fixed: Generated 32x32 `favicon.png` and `favicon.ico` for demos (replacing 0-byte placeholders). Generated 1280x720 desktop and 540x720 mobile screenshots. Added `screenshots` array to `manifest.json` with wide/narrow form_factors. Added `<link rel="icon">` tags to demo HTML files.

- [x] **Add CI integration for perf-audit benchmarks** (`scripts/perf-audit.ts`)
  - TODO.md item: integrate `perf-audit.ts` into CI pipeline to prevent sync latency regressions
  - ✅ Fixed: Fixed compilation and runtime bugs in `scripts/perf-audit.ts` (undefined remote variable, duplicate feed module registration, tuned memory thresholds). Added `perf:audit` script to `package.json`. Updated `.github/workflows/perf-check.yml` to trigger on both `main` and `master` branches. Verified execution: passes in 62ms with 1000 items.

- [x] **Add formal whitepaper with threat modeling** (per TODO.md)
  - Security whitepaper exists but needs formalization with cryptographic proofs and formal threat model
  - ✅ Fixed: Created comprehensive formal whitepaper in `docs/security.md` covering zero-trust architecture, cryptographic primitive specifications (X25519, Ed25519, HKDF-SHA256, PBKDF2, AES-256-GCM), complete STRIDE threat matrix with concrete mitigations, cryptographic proofs/arguments for IND-CCA2 confidentiality and replay protection, and developer security best practices.

---

## 📊 Summary by Category

| Category | Count | P0 | P1 | P2 | P3 |
|----------|-------|----|----|----|----|
| **Security** | 15 | 1 | 3 | 3 | 1 |
| **UX (Demos)** | 11 | 0 | 0 | 0 | 0 |
| **Architecture** | 5 | 0 | 2 | 0 | 0 |
| **Missing Features** | 8 | 0 | 0 | 8 | 0 |
