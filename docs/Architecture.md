# SovereignS3nc Architecture

## 1. Overview
SovereignS3nc is an offline-first, decentralized data synchronization library designed to enable applications to own their data by storing it on any S3-compatible storage service. It provides a robust synchronization engine that handles local persistence, remote sync, encryption, and conflict resolution, allowing developers to build "Sovereign" applications where users control their data.

## 2. System Architecture

The system follows a client-centric architecture where the logic resides primarily on the client (browser or Node.js). The server (S3) acts as a "dumb" storage backend.

```mermaid
graph TD
    Client[Client Application] --> S3nc[SovereignS3nc Facade]
    
    subgraph "SovereignS3nc Library"
        S3nc --> LocalStore[Local Storage Adapter]
        S3nc --> Crypto[Crypto Adapter]
        S3nc --> Remote[Remote Adapter]
        S3nc --> Blobs[Blob Adapter]
        S3nc --> Modules[Modules (Social, Boards)]
    end
    
    LocalStore --> IndexedDB[(IndexedDB / File System)]
    Remote --> S3[(S3 Compatible Storage)]
    Blobs --> S3
```

## 3. Core Components

### 3.1 SovereignS3nc (Facade)
The `SovereignS3nc` class (`src/SovereignS3nc.ts`) is the main entry point. It orchestrates:
- **Initialization**: Setting up local/remote adapters and identity.
- **CRUD Operations**: `save`, `get`, `delete` for JSON documents.
- **Synchronization**: Managing the sync loop, push/pull, and conflict resolution.
- **Sharing**: Managing shared documents and public indices.

### 3.2 Adapters
The library uses an adapter pattern to remain environment-agnostic.

*   **Storage Adapters (`IStorage`)**: Handle local data persistence.
    *   `InMemoryStorage`: For testing and Node.js ephemeral storage.
    *   `IndexedDBStorage`: For persistent browser storage.
*   **Remote Adapters (`IRemoteAdapter`)**: Handle communication with the sync backend.
    *   `S3RemoteAdapter`: Interacts with AWS S3, MinIO, etc., using the AWS SDK (or equivalent).
    *   `OCIPreAuthAdapter`: Specialized adapter for Oracle Cloud Infrastructure Pre-Authenticated Requests.
*   **Crypto Adapters (`ICryptoAdapter`)**: Handle encryption/decryption.
    *   `AESCryptoAdapter`: Uses Node.js `crypto` module (AES-256-GCM).
    *   `WebCryptoAdapter`: Uses the browser `SubtleCrypto` API.
*   **Blob Adapters (`IBlobAdapter`)**: Handle large binary files (images, attachments).
    *   `S3BlobAdapter`: Uploads/downloads raw binaries to S3.

### 3.3 Modules
Higher-level abstractions built on top of the core `SovereignS3nc` instance:
-   **ProfileManager**: Manages user identity and profile data.
-   **SocialManager**: Handles following users, feeds, and interactions.
-   **BoardManager**: Manages Kanban-style boards (example domain logic).
-   **StorageManager**: Simplifies blob upload/download with encryption support.

## 4. Data Model

### 4.1 SyncDocument
All data is stored as `SyncDocument` objects containing:
-   `_id`: Unique identifier (UUID).
-   `_rev`: Revision ID (for conflict detection).
-   `_updatedAt`: Timestamp of last modification.
-   `_deleted`: Tombstone flag for deletions.
-   `collection`: Logical grouping (e.g., 'posts', 'profiles').
-   `data`: The actual payload (encrypted string or plain object).

### 4.2 Storage Layout (S3)
Data is organized in S3 using a directory-like structure to ensure isolation and discovery:

```
{bucket}/{appId}/{userId}/{storeId}/
    ├── index.json        # Manifest of all files (optional, for optimization)
    ├── {docId}.json      # Individual document
    ├── blobs/            # Binary assets
    │   └── {blobId}
    └── public/           # Publicly shared metadata
        ├── index.json
        └── {shareId}
```

-   **appId**: Unique identifier for the application (e.g., `my-social-app`).
-   **userId**: The user's Public ID (GUID).
-   **storeId**: Usually `default` for private data, `shared` for public data.

## 5. Synchronization Process

The `sync()` method performs a two-way synchronization:

1.  **Pull (Remote to Local)**:
    *   Lists changes from the remote `storeId` since `lastSyncTime`.
    *   Downloads new or updated documents.
    *   **Conflict Resolution**:
        *   **Last-Write-Wins (Default)**: Compares `_updatedAt` timestamps. Newer wins.
        *   **Merge**: Optionally deep-merges JSON content.
    *   Decrypts data and updates the local store.

2.  **Push (Local to Remote)**:
    *   Identifies local documents changed since `lastSyncTime`.
    *   Encrypts the data (if encryption is enabled).
    *   Uploads to S3.
    *   Updates the local `_etag` to match the remote version.

3.  **Social / Shared Sync**:
    *   Iterates through followed users.
    *   Checks their `shared` store for new public content.
    *   Downloads, (optionally) decrypts using shared keys, and stores locally in `followed_content`.

## 6. Security Model

### 6.1 Client-Side Encryption
*   **Encryption at Rest (Local)**: Depends on the local adapter (IndexedDB is generally unencrypted but sandboxed).
*   **Encryption in Transit**: TLS (HTTPS) to S3.
*   **Encryption at Rest (Remote)**: Data is encrypted *before* leaving the client using AES-256-GCM. The S3 provider only sees opaque ciphertext.
*   **Keys**: The encryption key is held only by the client. It is never sent to the server.

### 6.2 Sharing Mechanism
*   **Private**: Default. Encrypted with the user's private key.
*   **Public Share**:
    1.  A random symmetric key is generated for the document.
    2.  The document is encrypted with this random key.
    3.  A "Share Metadata" document is created in the `public/` folder containing the document ID and the random key.
    4.  The Share Metadata is uploaded to the public path.
    *   *Note*: For purely public data (like profiles), encryption might be skipped or a well-known key used.

## 7. Identity
*   **Anonymous**: Users can start without an identity.
*   **Sovereign Identity**: A generic `_sovereign_identity` document stores the user's `publicId` and keys.
*   **Discovery**: Users are discovered via their `publicId`. In a real-world scenario, a directory service or side-channel would map human-readable names to these IDs.
