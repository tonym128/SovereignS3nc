# SovereignS3nc

A generic, offline-first data storage library that syncs with any S3-compatible object storage (AWS S3, Oracle OCI Object Storage, Garage, MinIO, etc.).

## Features

- **Offline-First**: Reads and writes to local storage (in-memory or file-based).
- **S3 Sync**: Automatically syncs changes to an S3 bucket.
- **Optimized Sync**: Uses S3 ETags to avoid unnecessary downloads.
- **Generic**: Store any JSON-serializable data.
- **Conflict Resolution**: Last-Write-Wins (LWW) strategy.
- **Pluggable**: Use the built-in file storage or provide your own local storage adapter (e.g., wrapping IndexedDB, SQLite, etc.).

## Installation

```bash
npm install sovereigns3nc
```

## Usage

### 1. Initialize

```typescript
import { SovereignS3nc } from 'sovereigns3nc';

const db = new SovereignS3nc({
  s3: {
    region: 'us-east-1', // or your region
    endpoint: 'https://s3.us-east-1.amazonaws.com', // Optional for AWS, required for others
    credentials: {
      accessKeyId: 'YOUR_ACCESS_KEY',
      secretAccessKey: 'YOUR_SECRET_KEY'
    },
    bucketName: 'my-app-data'
  },
  paths: {
    appId: 'my-app-guid',
    userId: 'user-guid-123',
    storeId: 'notes-store'
  },
  syncIntervalMs: 5000,
  conflictResolutionStrategy: 'Merge', // 'Merge' (default) or 'LastWriteWins'
  encryptionKey: 'your-32-byte-secret-key-here' // Optional: Transparent encryption
});

await db.init();

### Local-Only Mode (Offline First)

You can initialize `SovereignS3nc` without S3 credentials to work in a strictly local mode. This is useful for onboarding users before they have an account or if you want to delay cloud sync.

```typescript
const db = new SovereignS3nc({
  paths: { appId, userId, storeId },
  encryptionKey: '...'
});

await db.init();
// Works fully offline
await db.save({ ... });
```

### Connect to Cloud

Later, when credentials are available, you can connect and sync everything (including retroactive shares):

```typescript
await db.connect({
  region: 'us-east-1',
  bucketName: 'my-bucket',
  credentials: { ... }
});
```

### Encryption

If `encryptionKey` is provided, all document data is transparently encrypted (AES-256-GCM) before being saved to local storage or synced to S3.
- **Export**: Returns decrypted JSON (plain text) for backup/portability.
- **Import**: Accepts decrypted JSON and re-encrypts it upon storage.
- **Metadata**: Document IDs and timestamps remain unencrypted for sync coordination.

### Using IndexedDB (Browser)

For web applications, you can use the built-in `IndexedDBStorage` adapter for persistence across page reloads.

```typescript
import { SovereignS3nc, IndexedDBStorage } from 'sovereigns3nc';

const db = new SovereignS3nc(
  {
    s3: { ... }, // S3 Config
    syncIntervalMs: 5000
  },
  new IndexedDBStorage('MyAppDB', 'documents')
);

await db.init();
```

### 2. CRUD Operations

```typescript
// Save a document
const id = await db.save({
  title: 'My Note',
  content: 'Hello World'
});

// Get a document
const doc = await db.get(id);
console.log(doc);

// Delete
await db.delete(id);

// List all
const allDocs = await db.getAll();
```

### 3. Sync

If `syncIntervalMs` is set, sync happens automatically. You can also trigger it manually:

```typescript
// Check status
if (db.syncing) {
  console.log('Sync in progress...');
}

console.log('Last Sync:', new Date(db.lastSyncedAt));

// Listen for events
db.on('syncComplete', (stats) => {
  console.log('Sync finished:', stats);
});

// Force sync
await db.sync();
```

### 4. Import / Export

You can export data to a JSON string (e.g., for backup) and import it back (e.g., for restore or seeding). Importing merges changes with existing data.

```typescript
// Export all data
const jsonBackup = await db.export();

// Export specific document
const singleDocJson = await db.export('my-doc-id');

// Import
await db.import(jsonBackup);
```

### 5. Sharing

SovereignS3nc allows you to share documents. Shared documents are replicated to a separate "shared" path in your S3 bucket, allowing for read-only access by others or yourself across different application contexts.

#### Private Sharing
Creates a read-only copy of the document in a shared location. Updates to the original document are automatically propagated.

```typescript
// Share a document
const sharedId = await db.share('original-doc-id');
console.log(`Shared at: ${sharedId}`);

// Unshare (removes the shared copy)
await db.unshare('original-doc-id');
```

#### Public Sharing
Public sharing generates a unique encryption key for the document and publishes a metadata file to the `shared/public/` directory. This allows anyone with access to that bucket path (and the specific key) to discover and decrypt the content.

*Note: The public index uses a directory-based approach (`shared/public/{sharedId}.json`) to ensure atomic, conflict-free updates.*

```typescript
// Share publicly
const sharedId = await db.share('original-doc-id', true);
```

#### Consuming Shared Documents
You can list publicly available documents and save them to your local store. The system handles decrypting the public content and re-encrypting it with your personal master key.

```typescript
// List public shares (fetches metadata from shared/public/)
const publicShares = await db.getPublicShares();

// Import a shared document
if (publicShares.length > 0) {
  const { id, key } = publicShares[0];
  const localId = await db.saveSharedDocToLocal(id, key);
  console.log(`Imported shared doc as: ${localId}`);
}
```

## API Reference

The `SovereignS3nc` class provides a generic interface that abstracts away the underlying storage details.

### Properties
- `syncing: boolean`: Returns `true` if a sync is currently in progress.
- `lastSyncedAt: number`: Timestamp of the last successful sync.

### Methods
- `init(): Promise<void>`: Initialize local storage and load metadata.
- `save<T>(data: T): Promise<string>`: Create or update a document. Returns the ID.
- `get<T>(id: string): Promise<T | null>`: Retrieve a document by ID.
- `getAll<T>(): Promise<T[]>`: Retrieve all non-deleted documents.
- `delete(id: string): Promise<void>`: Soft-delete a document.
- `sync(): Promise<SyncStats>`: Force a synchronization cycle.
- `export(id?: string): Promise<string>`: Export all or a specific document to a JSON string.
- `import(json: string): Promise<void>`: Bulk load/merge documents from a JSON string.
- `share(id: string, isPublic?: boolean): Promise<string>`: Share a document (privately or publicly). Returns the shared ID.
- `unshare(id: string): Promise<void>`: Stop sharing a document and delete the remote copy.
- `getPublicShares(): Promise<any[]>`: List all publicly shared documents available in the shared store.
- `saveSharedDocToLocal(sharedId: string, key: string): Promise<string>`: Fetch, decrypt, and save a shared document to your local store.

## S3 Bucket Setup

For SovereignS3nc to function correctly with sharing enabled, your S3 bucket (or IAM user) needs permissions to access both the private user paths and the global shared path.

### Path Structure
- **Private User Data:** `${appId}/${userId}/${storeId}/...`
- **Shared/Public Data:** `${appId}/shared/shared/...`

### Security Model: Isolation via GUIDs (Single Credential)

In many deployments, a single S3 IAM user is shared across all application instances. In this model, isolation is achieved through **Security via Obscurity**:
- **GUIDs:** The `userId` and `storeId` are high-entropy GUIDs. The probability of one user guessing another user's 128-bit ID is effectively zero.
- **Restricted Listing:** By disabling the ability to list the root of the bucket and only allowing listing on specific prefixes, malicious discovery of other users' IDs is prevented.
- **MANDATORY HTTPS:** Since the GUIDs are part of the file path (URL), you **MUST** use HTTPS. If you use plain HTTP, the GUIDs will be visible in network traffic, completely defeating this security model.

**Note:** The `sync()` function **requires** `s3:ListBucket` permissions on the user's specific prefix to identify remote changes.

### Minimal IAM Policy (Single Credential Model)

Use this policy if all your users share the same S3 Access Key. It allows sync for the active user and discovery for the public share, while preventing "walking" the bucket to find other users.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ObjectAccess",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject"
            ],
            "Resource": "arn:aws:s3:::your-bucket-name/*"
        },
        {
            "Sid": "AllowSyncAndPublicDiscovery",
            "Effect": "Allow",
            "Action": "s3:ListBucket",
            "Resource": "arn:aws:s3:::your-bucket-name",
            "Condition": {
                "StringLike": {
                    "s3:prefix": [
                        "${appId}/${userId}/${storeId}/*",
                        "${appId}/shared/shared/public/*"
                    ]
                }
            }
        }
    ]
}
```

## Configuration Examples

### AWS S3
```typescript
{
  region: 'us-west-2',
  bucketName: 'my-bucket',
  credentials: { ... }
}
```

### Garage (Self-Hosted)
```typescript
{
  region: 'garage', // often ignored or 'us-east-1'
  endpoint: 'http://localhost:3900',
  forcePathStyle: true, // Important for some S3 clones
  bucketName: 'my-bucket',
  credentials: { ... }
}
```

### OCI Object Storage
```typescript
{
  region: 'us-phoenix-1',
  endpoint: 'https://<namespace>.compat.objectstorage.us-phoenix-1.oraclecloud.com',
  bucketName: 'my-bucket',
  credentials: { ... }
}
```

## Architecture

- **Local Store**: Keeps a copy of data locally. Default implementation uses an in-memory map backed by a JSON file.
- **Remote Adapter**: Communicates with S3.
- **Documents**: Stored as individual JSON files in the S3 bucket under `docs/<id>.json`.

## License

ISC
