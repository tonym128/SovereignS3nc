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
