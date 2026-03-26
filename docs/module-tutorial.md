# SovereignS3nc Module Developer Tutorial

This tutorial explains how to build custom modules for SovereignS3nc. You will learn about the Module API, data storage patterns, and how to ensure your data syncs across devices and users.

## What is a Module?

In SovereignS3nc, a **Module** is a self-contained piece of logic that manages its own data using the platform's secure storage and sync engine. Examples of existing modules include `Feed` (for social posts), `Messaging` (for DMs), and `Profile` (for user info).

## 1. Module Definition

Every module starts with a `ModuleDefinition`. This informs SovereignS3nc about the tables and migrations required by your module.

```typescript
import { ModuleDefinition } from 'sovereigns3nc';

export const TODO_MODULE_DEFINITION: ModuleDefinition = {
    name: 'todo',
    tables: [
        {
            name: 'todos',
            schema: `
                id TEXT PRIMARY KEY,
                task TEXT,
                completed INTEGER DEFAULT 0,
                timestamp INTEGER,
                userId TEXT
            `
        }
    ],
    migrations: [
        {
            version: 1,
            sql: [
                "ALTER TABLE todos ADD COLUMN priority INTEGER DEFAULT 0;"
            ]
        }
    ]
};
```

## 2. The Module Class

A module is typically implemented as a class that receives an instance of `SovereignS3nc` in its constructor.

```typescript
import { SovereignS3nc } from 'sovereigns3nc';

export class TodoModule {
    private readonly MODULE_NAME = 'todo';

    constructor(private db: SovereignS3nc) {
        // Register the module definition with the core engine
        this.db.registerModule(TODO_MODULE_DEFINITION);
    }
}
```

## 3. Core APIs

### `db.getModulePath(moduleName, subPath, type)`

Generates a namespaced path for your module's files. This is critical to avoid collisions with other modules or core system files.

- `moduleName`: The name of your module (e.g., 'todo').
- `subPath`: The specific file name or sub-directory (e.g., '2023-10-27.db').
- `type`:
    - `'private'`: Data only you can see (synced to your encrypted private store).
    - `'public'`: Data anyone can see (synced to your discoverable public store).
    - `'followed'`: Data from users you are following.

### `sov.getStorage()`

Returns the `IStorage` interface for low-level file operations.

```typescript
const storage = this.sov.getStorage();
const data = await storage.getFile(path);
await storage.saveFile(path, binaryData);
```

### `sov.applyModuleSchema(db, moduleName)`

Applies the tables and migrations defined in your `ModuleDefinition` to a SQLite database instance.

```typescript
this.sov.applyModuleSchema(sqliteDb, this.MODULE_NAME);
```

## 4. Data Storage Patterns

### Daily Databases

Most modules use **daily databases** to keep file sizes small and make sync efficient.

```typescript
const date = new Date().toISOString().split('T')[0];
const path = this.sov.getModulePath(this.MODULE_NAME, `${date}.db`, 'private');
```

### Private vs. Public

- **Private**: Best for personal data like a private Todo list, drafts, or settings.
- **Public**: Best for shared content like social posts or public profiles.

### Followed Data

To read data from users you follow, use the `'followed'` type in `getModulePath`. Note that the `subPath` must start with the target `userId`.

```typescript
const path = this.sov.getModulePath(this.MODULE_NAME, `${targetUserId}/${date}.db`, 'followed');
```

## 5. Implementation Example: CRUD

Here is a simplified example of how to implement a "Create" operation in a module.

```typescript
async addTodo(task: string) {
    const date = new Date().toISOString().split('T')[0];
    const path = this.sov.getModulePath(this.MODULE_NAME, `${date}.db`, 'private');
    
    // 1. Load existing DB from storage
    const data = await this.sov.getStorage().getFile(path);
    
    // 2. Initialize SQLite (assuming sql.js is available)
    const db = new SQL.Database(data || undefined);
    
    // 3. Apply schema
    this.sov.applyModuleSchema(db, this.MODULE_NAME);
    
    // 4. Run SQL
    db.run('INSERT INTO todos (id, task, timestamp) VALUES (?, ?, ?)', 
           [Math.random().toString(36), task, Date.now()]);
    
    // 5. Export and Save
    const binary = db.export();
    await this.sov.getStorage().saveFile(path, binary);
    
    // 6. Notify the system (triggers sync and UI updates)
    this.sov.onModuleUpdate(this.MODULE_NAME, path);
    
    db.close();
}
```

## 6. Lifecycle of Data Syncing

When you call `sov.sync()`, the following happens:

1.  **Local Changes**: Any files you saved in `private/modules/` or `public/modules/` are uploaded to your remote S3/WebRTC store.
2.  **Remote Changes**: The engine downloads any new module files found on your remote store (e.g., changes from another device).
3.  **Followed Data**: The engine checks the public stores of users you follow for new files in `public/modules/your-module-name/`.
4.  **Events**: When a module file is updated via sync, SovereignS3nc emits an event:
    ```typescript
    sov.on('todo:update', ({ path }) => {
        console.log(`Module data updated at ${path}`);
        // Refresh your UI!
    });
    ```

## 7. Encryption and Security

- **Private Store**: All files in `private/` are automatically encrypted with your master key before being uploaded to the remote.
- **DMs**: Use `sov.sendEncryptedPayload(recipientId, payload, namespace)` for end-to-end encrypted messaging between users.
- **Blobs**: Use `sov.saveBlob(data, isPublic)` for large files like images. They are content-addressed (hashed) for efficiency.

## Summary

1. Define your schema in a `ModuleDefinition`.
2. Register it in your module class constructor.
3. Use `getModulePath` to organize your files.
4. Use `onModuleUpdate` to trigger sync.
5. Listen for `${moduleName}:update` to refresh your UI.
