# GEMINI CLI Skill: SovereignS3nc

## Overview
SovereignS3nc is a decentralized, offline-first data storage and synchronization library. It empowers developers to build local-first applications where data is owned by the user and synced directly to S3-compatible storage (AWS S3, Oracle OCI, MinIO, RustFS, etc.) without a middle-tier server.

## Architecture
SovereignS3nc operates on a **Daily-DB pattern** combined with a pluggable module system:
- **Local-First Storage**: Uses IndexedDB (browser) or SQLite/Filesystem (Node.js) for immediate local access.
- **Daily SQLite Databases**: Active modules store data in daily SQLite files (e.g., `2024-03-25.db`). This simplifies incremental syncing and conflict resolution.
- **S3 Sync Engine**: A hash-based "last-write-wins" approach. During `sync()`, local databases are hashed, optionally encrypted, and uploaded to S3. Followed users' databases are pulled and cached.
- **Prefix Isolation**: Data is organized by path prefixes: `${appId}/${userId}/${storeId}/`. S3 policies ensure users only have write access to their own prefixes.
- **Identity & E2EE**: Uses `tweetnacl` for X25519 identity keys. All private data is encrypted symmetrically (AES-256-GCM), and DMs use Diffie-Hellman shared secrets.

## Key Primitives

### 1. Synchronization (`sync`)
The `sync()` method is the heart of the library. It:
- Pushes local changes to the user's S3 prefix.
- Pulls updates from all followed users.
- Discovers new users via the global registry.
- Updates local caches for offline access.

### 2. Modules
Modules are specialized units of logic (e.g., `Profile`, `Messaging`, `Feed`). They:
- Define their own SQLite schemas and migrations.
- Use namespaced paths: `public/modules/{name}/` or `private/modules/{name}/`.
- Are registered via `sovereign.registerModule(definition)`.

### 3. End-to-End Encryption (E2EE)
- **Symmetric Encryption**: Used for personal private data. The key is derived from the user's password.
- **Asymmetric Encryption**: Used for DMs. A shared secret is derived between the sender's private key and recipient's public key.
- **Identity**: A user's `userId` and `publicKey` are public, while the `privateKey` remains encrypted locally.

## Step-by-Step Guide: Building a New Module

### Step 1: Define the Schema (`ModuleDefinition`)
Create a definition that specifies the module name, SQLite tables, and migrations.

```typescript
import { ModuleDefinition } from 'sovereigns3nc';

export const MY_FEATURE_DEFINITION: ModuleDefinition = {
    name: 'my_feature',
    tables: [
        {
            name: 'items',
            schema: `
                id TEXT PRIMARY KEY,
                title TEXT,
                content TEXT,
                timestamp INTEGER
            `
        }
    ],
    migrations: [
        {
            version: 1,
            sql: ['ALTER TABLE items ADD COLUMN priority INTEGER DEFAULT 0;']
        }
    ]
};
```

### Step 2: Create the Module Class
Implement a class that wraps `SovereignS3nc` and handles database initialization.

```typescript
export class MyFeatureModule {
    constructor(private sov: SovereignS3nc) {
        // Register the module definition with the core engine
        this.sov.registerModule(MY_FEATURE_DEFINITION);
    }

    private async getDb(date: string) {
        // Generate the path for today's database
        const path = this.sov.getModulePath('my_feature', `${date}.db`, 'public');
        const data = await this.sov.getStorage().getFile(path);
        
        // Initialize SQL.js database
        const SQL = await initSqlJs(); 
        const db = new SQL.Database(data || undefined);

        // Apply migrations and core schema
        this.sov.applyModuleSchema(db, 'my_feature');
        return db;
    }
}
```

### Step 3: Implement Business Logic
Add methods to interact with the database and save changes.

```typescript
async addItem(title: string, content: string) {
    const date = new Date().toISOString().split('T')[0];
    const db = await this.getDb(date);
    
    // Perform SQLite operations
    db.run('INSERT INTO items (id, title, content, timestamp) VALUES (?, ?, ?, ?)', 
           [crypto.randomUUID(), title, content, Date.now()]);

    // Export and save the updated database
    const binary = db.export();
    const path = this.sov.getModulePath('my_feature', `${date}.db`, 'public');
    await this.sov.getStorage().saveFile(path, binary);
    
    // Notify the UI and trigger background sync if needed
    this.sov.onModuleUpdate('my_feature', path);
}
```

## Best Practices for Offline-First Development

1.  **Daily Partitioning**: Always store active data in daily databases. This keeps individual files small and makes synchronization efficient by only uploading/downloading modified days.
2.  **Optimistic UI**: Update your application state immediately after saving to the local SQLite database. Do not wait for `sync()` to complete.
3.  **Sync Event Listeners**: Use `sovereign.onModuleUpdate(moduleName, callback)` to listen for changes pulled from remote storage and refresh your UI accordingly.
4.  **Privacy by Design**: Store sensitive data in the `private/` prefix. SovereignS3nc automatically handles symmetric encryption for any file in a private path.
5.  **Blob Strategy**: For large files (images, videos), store them as blobs in `public/blobs/` and store the path reference in your SQLite database. This keeps the database files lean.
6.  **Conflict Resilience**: Design your data model to be resilient to "last-write-wins" at the file level. For example, instead of one large monolithic database, use many small ones or use append-only structures where appropriate.
