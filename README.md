# SovereignS3nc

A decentralized, offline-first data storage and synchronization library designed to connect client applications directly to any S3-compatible object storage (AWS S3, Oracle OCI, MinIO, RustFS, etc.).

## Overview

SovereignS3nc empowers developers to build local-first, decentralized applications. Data is stored locally (via IndexedDB in the browser or SQLite/Filesystem in Node.js) and synced with remote S3 buckets using a robust, hash-based "last-write-wins" approach.

### Key Features

- **Offline-First**: Operates seamlessly on local storage and syncs changes only when network connectivity is available.
- **End-to-End Encrypted (E2EE)**: True asymmetric E2EE identity using `tweetnacl` (X25519 identity keys + AES-256-GCM symmetric encryption).
- **Pluggable Module Architecture**: Granular modules for specialized use cases:
    - **Profile**: Manage identity, public profiles, and following graphs.
    - **Messaging**: Secure, E2EE Direct Messaging with image support.
    - **Feed**: Public social feeds with nested comments, likes, and attachments.
- **Global Discovery**: Automatically discover and follow users through a global registry.
- **Multi-writer Groups**: Support for shared group stores with symmetric encryption.
- **Universal Storage**: Seamlessly transition between Browser (IndexedDB) and Node.js (SQLite/FileSystem) environments.

## Installation

```bash
npm install sovereigns3nc
```

## Basic Usage

```typescript
import { SovereignS3nc } from 'sovereigns3nc';

// 1. Configure SovereignS3nc
const sovereign = new SovereignS3nc({
  s3: {
    region: 'us-east-1',
    endpoint: 'https://...', // For RustFS/Minio/OCI/S3
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
  password: 'my-super-strong-password', // Used to derive E2EE Identity Keys
  debug: true
});

// 2. Initialize (generates E2EE keypairs and connects to local storage)
await sovereign.init();

// 3. Sync changes (Pull updates from followed users & Push local changes)
await sovereign.sync();
```

## Module System

SovereignS3nc includes high-level modules to handle common application logic:

```typescript
import { FeedModule, MessagingModule, ProfileModule } from 'sovereigns3nc';

// Profile Management
const profile = new ProfileModule(sovereign);
await profile.updateProfile({ displayName: "Alice", bio: "Hello World" });

// E2EE Messaging
const messaging = new MessagingModule(sovereign);
await messaging.sendMessage("bob-123", "Hey Bob, check this out!", "feed");

// Social Feeds
const feed = new FeedModule(sovereign);
await feed.createPost("My first decentralized post!");
```

## Documentation

For detailed information on configuring, deploying, and using SovereignS3nc, please refer to the documentation in the `docs/` directory:

- **Core Concepts**
  - [API Reference](docs/api.md) - Detailed API documentation for the core library and modules.
  - [Data Model](docs/data-model.md) - Understanding how SovereignS3nc structures data on S3.
  - [Gemini CLI Skill](docs/gemini-skill.md) - A guide for AI-assisted development with SovereignS3nc.

- **Setup & Deployment**
  - [Deployment Guide](docs/deployment.md) - Detailed configuration for **MinIO**, **Cloudflare R2**, and **DigitalOcean Spaces**.
  - [RustFS Setup](docs/rustfs.md) - **Recommended** high-performance local S3 development environment.
  - [AWS S3 Setup](docs/aws.md) - Configuring AWS IAM policies and buckets.
  - [Oracle OCI Setup](docs/oci.md) - Using Oracle Object Storage with S3 compatibility.
  - [PeerJS Setup](docs/peerjs.md) - Setting up the signaling server for WebRTC.
  - [WebRTC Setup](docs/webrtc.md) - Enabling P2P browser-to-browser synchronization.

- **Security**
  - [S3 Isolation Policy](Setup/GENERIC_S3_POLICY.json) - Template for bucket-level user isolation.

## Storage Adapters

The library automatically selects the best storage adapter for your environment:
- **Browser**: `IndexedDBStorage` (High performance, large capacity).
- **Node.js**: `NodeStorage` (File-system based) or `SQLiteNodeStorage` (Consolidated SQLite database).

## Security & Governance

SovereignS3nc uses a two-tier security model to balance user privacy with application moderation:

- **User Keys**: Individual S3 credentials scoped to `${appId}/${userId}/`. Users have full control over their own data but cannot access other users' private prefixes.
- **Admin Keys**: High-privilege credentials with write access to `${appId}/admin/`. Admins can use the [Admin CLI](docs/api.md#admin-cli) to manage reports, blacklist users, and perform app-wide data exports.

### Prefix-Based Isolation
For production deployments, we recommend enforcing path isolation at the S3 bucket policy level. See `Setup/GENERIC_S3_POLICY.json` for a template that secures your bucket while allowing users to sync and report abuse safely.

## Architecture

SovereignS3nc operates on a **Daily-DB** pattern:
1. Every day, a new local SQLite database is created for active modules.
2. During `sync()`, these databases are hashed, encrypted (if private), and uploaded to S3.
3. Followed users' databases are downloaded and cached locally for lightning-fast offline access.
4. Conflicts are resolved via timestamps and SHA-256 hash comparisons.

## Security

- **Private GUID**: Your private data is stored at a deterministic path derived from your password using a salted SHA-256 hash, making it "unfindable" by others.
- **Identity Keys**: Uses `tweetnacl` to generate X25519 keys from your password.
- **Shared Secrets**: DMs use Diffie-Hellman Key Exchange to derive shared secrets, ensuring only the sender and recipient can read the content.
- **Offline Verification**: Passwords are verified against a local encrypted sentinel during offline login.
