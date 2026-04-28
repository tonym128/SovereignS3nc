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
| `adminPublicKey` | `string` | Public key of the admin for sending encrypted abuse reports. |
| `debug` | `boolean` | Enables verbose logging to the console. |

### Core Methods

| Method | Description |
| :--- | :--- |
| `sync(force?: boolean)` | Performs a two-way synchronization. Returns a promise that resolves when complete. |
| `getStorage()` | Returns the local `IStorage` adapter (IndexedDB or Node FS). |
| `getConfig()` | Returns the active `SovereignConfig`. |
| `registerModule(def)` | Registers a custom module definition (schema and migrations). |
| `follow(userId)` | Follows another user to begin syncing their public data. |
| `unfollow(userId)` | Stops following a user. |
| `getPublicRegistry()` | Retrieves the list of all discovered users from the global registry. |
| `on(event, callback)` | Subscribe to events like `sync`, `conflict`, or `change`. |
| `resolveConflict(id, choice)`| Resolves a pending sync conflict (`'local' \| 'remote' \| 'abort'`). |
| `connectNativeRTC(transport)`| Connects a `NativeWebRTCTransport` to the internal gossip engine. |

---

## 2. Advanced Transports & Signaling

### `NativeWebRTCTransport`
Used for serverless signaling (QR/BLE).
- `createOffer()`: Generates an SDP Offer for the initiator.
- `handleOffer(sdp)`: Accepts a remote offer and generates an SDP Answer.
- `handleAnswer(sdp)`: Finalizes the handshake on the initiator side.
- `onConnected`: Callback triggered when the direct data channel is open.

### `BLESignaling`
Utility for Bluetooth-based handshakes.
- `scanAndPair(onOfferReceived)`: Scans for Sovereign BLE peripherals and handles the SDP exchange.

---

## 3. Module APIs

SovereignS3nc includes high-level modules that provide specialized functionality.

### `ProfileModule`
Manage user identity and discovery.
- `getProfile(userId)`: Returns the profile object for any user.
- `updateProfile(name, bio, avatar?)`: Updates the current user's public profile.
- `getFollowing()`: Returns the list of users the current user is following.

### `MessagingModule`
End-to-end encrypted direct messaging.
- `getMessages(otherUserId)`: Retrieves chat history with a specific user.
- `sendDirectMessage(toUserId, content, image?)`: Sends an E2EE message.
- `deleteMessage(otherUserId, messageId)`: Marks a message as deleted on local and remote.

### `FeedModule`
Public social feeds and content sharing.
- `getPosts(userId, date?)`: Retrieves posts for a user on a specific date.
- `createPost(content, image?, parentId?)`: Creates a new public post or reply.
- `likePost(userId, postId, date)`: Toggles a "like" on a specific post.
- `getGroupPosts(groupId, date)`: Retrieves posts from a shared multi-writer group.

---

## 3. Custom Module Development

SovereignS3nc includes an administrative CLI for managing the application state.

### Commands
| Command | Description |
| :--- | :--- |
| `list-reports` | List all user-submitted abuse reports. |
| `ban-user <userId>` | Blacklist a user by their ID. |
| `export-data` | Perform a full backup of all accessible data. |
| `burn-it-to-the-ground` | **Destructive**: Delete all data from the remote backend. |

### Usage
```bash
npm run admin-cli -- list-reports
```

---

## 4. Storage Architecture


Modules allow you to build specialized features (like a Feed, Messaging, or a Wiki) while leveraging the library's core sync and security engines.

### Step 1: Define the Module
A module is defined by its name and its SQLite schema.

```typescript
import { ModuleDefinition } from './types';

export const MY_MODULE_DEFINITION: ModuleDefinition = {
    name: 'my_feature',
    tables: [
        {
            name: 'items',
            schema: `
                id TEXT PRIMARY KEY,
                title TEXT,
                timestamp INTEGER
            `
        }
    ],
    migrations: [
        {
            version: 1,
            sql: ['ALTER TABLE items ADD COLUMN description TEXT;']
        }
    ]
};
```

### Step 2: Create the Module Class
Your module class should wrap the `SovereignS3nc` instance and register itself during construction.

```typescript
export class MyModule {
    constructor(private sov: SovereignS3nc) {
        this.sov.registerModule(MY_MODULE_DEFINITION);
    }

    private async getDb(date: string) {
        const path = this.sov.getModulePath('my_feature', `${date}.db`, 'public');
        const data = await this.sov.getStorage().getFile(path);
        
        // Initialize SQL.js (ensure it's loaded in your environment)
        const SQL = await initSqlJs(); 
        const db = new SQL.Database(data || undefined);

        // Apply core schema management
        this.sov.applyModuleSchema(db, 'my_feature');
        return db;
    }
}
```

### Step 3: Implement Business Logic
Use the core API to save data and trigger synchronization.

```typescript
async addItem(title: string) {
    const date = new Date().toISOString().split('T')[0];
    const db = await this.getDb(date);
    
    db.run('INSERT INTO items (id, title, timestamp) VALUES (?, ?, ?)', 
           [Math.random().toString(36), title, Date.now()]);

    // Save back to storage
    const binary = db.export();
    const path = this.sov.getModulePath('my_feature', `${date}.db`, 'public');
    await this.sov.getStorage().saveFile(path, binary);
    
    // Notify the UI
    this.sov.onModuleUpdate('my_feature', path);
}
```

---

## 3. Storage Architecture

SovereignS3nc follows a **Daily SQLite** pattern:
*   **Public Data**: Stored in `public/modules/{module}/{YYYY-MM-DD}.db`.
*   **Private Data**: Stored in `private/modules/{module}/{YYYY-MM-DD}.db` (encrypted symmetrically).
*   **Followed Data**: Downloaded into `followed/{userId}/modules/{module}/{YYYY-MM-DD}.db`.

### Prefix Isolation
The library enforces path-based isolation. Users only have read/write access to their own prefixes on S3, while the `Global Discovery` registry is shared in a `global/` prefix.

---

## 4. Security & Encryption

*   **Asymmetric E2EE**: Used for Direct Messages. A shared secret is derived using `tweetnacl` (X25519) and the payload is encrypted using `AES-256-GCM`.
*   **Symmetric Encryption**: Used for personal private data. The key is derived from the user's password using `PBKDF2`.
*   **Identity**: Your `userId` is your public identifier. Your `publicKey` is stored in the global registry so others can send you encrypted DMs.
