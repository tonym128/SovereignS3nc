# SovereignS3nc API Reference & Developer Guide

This guide provides a comprehensive overview of the SovereignS3nc API and instructions for building custom modules to extend the library's functionality.

---

## 1. Core API Reference (`SovereignS3nc` class)

The `SovereignS3nc` class is the main entry point for the library. It manages storage, synchronization, and security.

### Initialization

The recommended way to initialize the library is using the static `create` factory method. This handles construction, local storage setup, and key derivation in one step.

```typescript
const sovereign = await SovereignS3nc.create(config: SovereignConfig);
```

#### `SovereignConfig` Interface

| Property | Type | Description |
| :--- | :--- | :--- |
| `s3` | `S3Config` | Configuration for S3-compatible remote storage. |
| `offline` | `boolean` | If true, starts in offline mode without attempting remote connections. |
| `paths` | `object` | Required: `{ appId: string, userId: string, storeId: string }` |
| `password` | `string` | User's password for deriving E2EE identity keys. |
| `useWorker` | `boolean` | If true, enables background synchronization via Web Worker. |
| `workerUrl` | `string` | URL/Path to the `worker.js` file for background sync. |
| `enablePeerExchange` | `boolean` | (WebRTC) If true, enables PEX (Peer Exchange) to discover and hand-shake with peers-of-peers automatically. |
| `adminPublicKey` | `string` | Public key of the admin for sending encrypted abuse reports. |
| `localPersistencePath` | `string` | Optional: Overrides the default Node.js storage path. |
| `debug` | `boolean` | Enables verbose logging to the console. |

### Core Methods

| Method | Description |
| :--- | :--- |
| `sync(force?: boolean)` | Performs a two-way synchronization and resolves to a `SyncRunResult` describing each phase and any diagnostics. |
| `getStorage()` | Returns the local `IStorage` adapter (IndexedDB or Node FS). |
| `getConfig()` | Returns the active `SovereignConfig`. |
| `registerModule(def)` | Registers a custom module definition (schema and migrations). |
| `follow(userId)` | Follows another user to begin syncing their public data. |
| `unfollow(userId)` | Stops following a user. |
| `getPublicRegistry()` | Retrieves the list of all discovered users from the global registry. |
| `on(event, callback)` | Subscribe to events like `sync`, `conflict`, or `update`. |
| `resolveConflict(id, choice)`| Resolves a pending sync conflict (`'local' \| 'remote' \| 'abort'`). |
| `saveBlob(data, public?)` | Saves a binary blob and returns its deterministic path. |
| `getBlob(path, userId?)` | Retrieves a blob from local storage or a remote peer/S3. |

`SyncRunResult` contains a unique `runId`, an overall status (`succeeded`, `partial`, `failed`, or `skipped`), timestamps, per-phase status, and stable diagnostic codes. A partial result means at least one phase failed; the library will not advance the last-sync checkpoint after a failed phase.

```typescript
const result = await sovereign.sync();
if (result.status !== 'succeeded') {
  for (const diagnostic of result.diagnostics) {
    console.warn(diagnostic.code, diagnostic.phase, diagnostic.runId);
  }
}

sovereign.on('sync:diagnostic', diagnostic => {
  // Codes are stable API; diagnostic messages intentionally omit raw remote errors.
  reportSyncIssue({ code: diagnostic.code, runId: diagnostic.runId });
});
```

Progress events (`sync:progress`) include `runId`, `phase`, and `state` alongside the existing `stage`, `done`, and `total` fields. Diagnostics currently use `SYNC_REMOTE_UNAVAILABLE`, `SYNC_ALREADY_RUNNING`, and `SYNC_PHASE_FAILED`.

---

## 2. Module APIs

SovereignS3nc includes high-level modules that provide specialized social functionality.

### `ProfileModule`
Manage user identity, avatars, and bios.

- **`getProfile(userId?: string)`**: 
  Returns a `Profile` object containing `name`, `bio`, `avatar` (Data URL), and `updatedAt`. If `userId` is omitted, returns the current user's profile.
- **`updateProfile(name: string, bio: string, avatar?: string)`**: 
  Updates the current user's public profile. Avatars are automatically compressed to stay under 100KB.
  *Limits: Name max 100 chars, Bio max 1000 chars.*
- **`getFollowing()`**: 
  Returns an array of `FollowedUser` objects (`userId`, `publicKey`, `lastSync`).
- **`syncOtherProfiles()`**: 
  Triggers a background fetch of all followed users' `user.json` files.

### `MessagingModule`
End-to-end encrypted direct messaging using X25519 (tweetnacl) and AES-256-GCM.

- **`sendDirectMessage(recipientId: string, content: string, image?: Uint8Array)`**: 
  Sends an E2EE message. If an image is provided, it is uploaded as an encrypted blob.
  *Limits: Content max 5000 chars.*
- **`getInboxMessages(days: number = 5)`**: 
  Retrieves and decrypts DM history for the last `X` days from all followed users.
- **`getMessageImage(message: Message)`**: Loads a DM attachment and decrypts new encrypted attachments on the client. Older messages without attachment encryption metadata remain readable; their public blobs should be treated as exposed.
- **`editMessage(recipientId: string, messageId: string, date: string, newContent: string)`**: 
  Overwrites a previously sent message.
- **`deleteMessage(recipientId: string, messageId: string, date: string)`**: 
  Marks a message as deleted for both sender and recipient.

### `FeedModule`
Public social feeds with nested comments, likes, and image attachments.

- **`post(content: string, isPublic: boolean = true, image?: Uint8Array, parentId?: string, parentUserId?: string)`**: 
  Creates a new post or a reply. Posts are stored in daily SQLite databases.
  *Limits: Content max 10000 chars.*
- **`getPosts(userId: string, date: string, type: 'public' | 'private' = 'public')`**: 
  Retrieves all posts for a specific user and date.
- **`likePost(userId: string, postId: string, date: string)`**: 
  Toggles a "like" on a post. Likes are stored in the user's own daily DB.
- **`getGroupPosts(groupId: string, date: string, sharedKey?: string)`**: 
  Retrieves posts from a shared encrypted group.

### `ModerationModule` (Admin Only)
Tooling for community management and data safety.

- **`reportContent(targetUserId, contentId, contentType, reason, evidence?)`**: 
  Submit an E2EE abuse report to the community admin.
- **`getReports()`**: 
  (Admin) Fetches and decrypts all pending reports.
- **`blacklistUser(userId)`**: 
  (Admin) Adds a user to the global `blacklist.json` to prevent others from following them.
- **`banUser(userId)`**: 
  (Admin) Hard-ban a user: blacklists them and deletes all their data from the S3 backend.
- **`requestPostDeletion(targetUserId, postId, date)`**: 
  (Admin) Sends a signed request to a user to delete a specific piece of content.

---

## 3. Storage Architecture

SovereignS3nc follows a **Daily SQLite** pattern to ensure infinite scalability and easy conflict resolution.

- **Public Prefix**: `${appId}/${userId}/${storeId}/public/modules/${moduleName}/${YYYY-MM-DD}.db`
- **Private Prefix**: `${appId}/${privateId}/${storeId}/private/modules/${moduleName}/${YYYY-MM-DD}.db`
- **Followed Prefix**: `followed/${targetUserId}/modules/${moduleName}/${YYYY-MM-DD}.db`

### Deterministic Blobs
Blobs (images, files) are stored by their SHA-256 hash.
- Path: `public/blobs/${sha256}` or `private/blobs/${sha256}`.

---

## 4. Security & Encryption

- **Identity**: Identity keys are derived from the user's password using **PBKDF2-HMAC-SHA256**.
- **Asymmetric E2EE**: DMs use **X25519 Diffie-Hellman** to derive a shared secret, followed by **AES-256-GCM** for the payload.
- **Symmetric Encryption**: Private files are encrypted with a master key derived from the password.
- **Path Isolation**: Users are isolated by S3 prefixes. Private data is stored under a "Private GUID" that is never shared, making it invisible even to other users of the same S3 bucket.

---

## 5. Custom Module Development

To create a new module, define a `ModuleDefinition` and wrap the `SovereignS3nc` instance.

```typescript
const MY_MODULE_DEFINITION = {
    name: 'wiki',
    tables: [{
        name: 'pages',
        schema: 'id TEXT PRIMARY KEY, title TEXT, body TEXT'
    }]
};

class WikiModule {
    constructor(private sov: SovereignS3nc) {
        this.sov.registerModule(MY_MODULE_DEFINITION);
    }
    
    async savePage(title: string, body: string) {
        const date = new Date().toISOString().split('T')[0];
        const path = this.sov.getModulePath('wiki', `${date}.db`, 'public');
        const db = await this.sov.getGroupStore('my-group', 'wiki', date); // Or regular getStorage().getFile()
        // ... logic ...
    }
}
```
