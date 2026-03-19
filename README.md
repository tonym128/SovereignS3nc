# SovereignS3nc

A daily SQLite-based synchronization library for S3.

## Overview

SovereignS3nc is designed for offline-first applications that store data in daily SQLite database files. It synchronizes these files with an S3-compatible object storage using a "last-write-wins" approach based on SHA-256 hashes.

### Key Features

- **Daily DB Sync**: Automatically detects and syncs `private/YYYY-MM-DD.db` and `public/YYYY-MM-DD.db` files.
- **No List Capability**: Works on S3 providers without requiring `ListObjects` permissions.
- **Catch-up Sync**: Automatically syncs missing days since the last successful sync.
- **User Metadata**: Syncs a common `public/user.json` file for user profile/identity.

## Usage

```typescript
import { SovereignS3nc } from 'sovereigns3nc';

const sovereign = new SovereignS3nc({
  s3: {
    region: 'us-east-1',
    endpoint: 'https://...',
    credentials: {
      accessKeyId: '...',
      secretAccessKey: '...'
    },
    bucketName: 'my-bucket'
  },
  paths: {
    appId: 'my-app',
    userId: 'user-123',
    storeId: 'main'
  },
  localPersistencePath: './data'
});

await sovereign.init();

// After your app writes to ./data/private/2026-02-06.db ...
await sovereign.sync();
```

## Architecture

- **Local Storage**: Uses a simple filesystem adapter.
- **Remote Storage**: Uses S3 `PutObject`, `GetObject`, and `HeadObject` (for hashes).
- **Conflict Resolution**: The local version is uploaded if its hash differs from the remote version. If a local file is missing but exists remotely, it is downloaded.
