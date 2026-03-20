# SovereignS3nc

A decentralized, offline-first data storage and synchronization library designed to connect client applications directly to any S3-compatible object storage (AWS S3, Oracle OCI, MinIO, Garage, etc.).

## Overview

SovereignS3nc empowers developers to build local-first, decentralized applications. Data is stored locally (via IndexedDB in the browser or an in-memory/file backend in Node.js) and synced with remote S3 buckets using a robust, hash-based "last-write-wins" approach.

### Key Features

- **Offline-First**: Operates seamlessly on local storage and syncs changes only when network connectivity is available.
- **End-to-End Encrypted (E2EE)**: True asymmetric E2EE identity using `tweetnacl` (X25519 identity keys + AES-256-GCM symmetric encryption). Perfect for secure Direct Messaging.
- **Pluggable Module Architecture**: Seamlessly build sub-applications using the Module API (`registerModule()`), ensuring application data is safely namespaced (e.g., `public/modules/social/`).
- **Global Discovery & Social Graph**: Discover other users through a global registry, follow them, and securely synchronize their public data, modules, and profiles.
- **Secure File/Blob Storage**: Store and share media files (images, audio, etc.) in generic `public/blobs/` or `private/blobs/` buckets.
- **No List Capability Required**: Designed to function on minimal S3 permissions without requiring `ListObjects`.

## Installation

```bash
npm install sovereigns3nc tweetnacl
```

## Basic Usage

```typescript
import { SovereignS3nc } from 'sovereigns3nc';

// 1. Configure SovereignS3nc
const sovereign = new SovereignS3nc({
  s3: {
    region: 'us-east-1',
    endpoint: 'https://...', // For Garage/Minio/OCI
    credentials: {
      accessKeyId: '...',
      secretAccessKey: '...'
    },
    bucketName: 'my-bucket',
    forcePathStyle: true
  },
  paths: {
    appId: 'my-app',
    userId: 'user-123',
    storeId: 'main'
  },
  password: 'my-super-strong-password', // Used to derive deterministic E2EE Master Keys
  debug: true
});

// 2. Initialize (generates E2EE keypairs and connects to local storage)
await sovereign.init();

// 3. Sync changes (handles pull, merge, and push of all registered modules and blobs)
await sovereign.sync();
```

## Module API Example

SovereignS3nc provides an API specifically to let developers build sub-applications ("Modules") like Social Feeds, Todo Lists, or Finance Trackers without worrying about sync state.

```typescript
export class MyCustomModule {
    private readonly MODULE_NAME = 'mymodule';

    constructor(private db: SovereignS3nc) {
        // Auto-registers this module to be included in the sync cycle
        this.db.registerModule(this.MODULE_NAME);
    }

    async saveMyData(date: string, payload: Uint8Array) {
        // Automatically namespaces data to avoid system collisions
        const path = this.db.getModulePath(this.MODULE_NAME, `data/${date}.bin`, 'private');
        await this.db.getStorage().saveFile(path, payload);
    }
}
```

## Architecture

- **Local Storage**: Uses `IndexedDBStorage` in the browser or `InMemoryStorage` for testing.
- **Remote Adapters**: Exposes an S3 wrapper, handling `PutObject`, `GetObject`, and `HeadObject` for hash optimization.
- **Security**: 
    - Derives a private, deterministic S3 prefix (Private GUID) based on the user's password so remote locations are obscured.
    - Generates X25519 identity keys for Diffie-Hellman Shared Secret generation, encrypting Direct Messages using AES-256-GCM.
