# SovereignS3nc API Reference & Developer Guide

This guide provides a comprehensive overview of the SovereignS3nc API and instructions for building custom modules to extend the library's functionality.

---

## 1. Core API Reference (`SovereignS3nc` class)

The `SovereignS3nc` class is the main entry point for the library. It manages storage, synchronization, and security.

### Initialization
```typescript
const sovereign = new SovereignS3nc(config: SovereignConfig);
await sovereign.init();
```

### Key Methods

| Method | Description |
| :--- | :--- |
| `init()` | Initializes local storage and derives E2EE keys from the password. |
| `sync()` | Performs a two-way synchronization between local and remote storage. |
| `getStorage()` | Returns the `IStorage` adapter for direct local file access. |
| `getConfig()` | Returns the current configuration instance. |
| `registerModule(def)` | Registers a custom module definition (schema and migrations). |
| `getModulePath(...)` | Generates a namespaced path for module data (e.g., `public/modules/feed/file.db`). |
| `applyModuleSchema(db, name)` | Automatically applies SQLite tables and migrations to a database instance. |
| `encrypt(data, key)` | Symmetrically or asymmetrically encrypts data. |
| `decrypt(data, key)` | Symmetrically or asymmetrically decrypts data. |
| `deriveSharedSecret(pk)` | Derives a shared secret using X25519 (Diffie-Hellman) for DMs. |
| `sendEncryptedPayload(id, payload, ns)` | Sends an E2EE payload to a recipient via their public inbox. |
| `follow(userId)` | Adds a user to the follow graph and begins syncing their public data. |

---

## 3. Admin CLI

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
