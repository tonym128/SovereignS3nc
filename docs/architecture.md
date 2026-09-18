# Architecture & System Internals

SovereignS3nc is engineered from the ground up as a **zero-trust, offline-first data synchronization engine**. This document details the system design, cryptographic isolation model, and data flow pipelines.

---

## 🏛️ High-Level System Architecture

```mermaid
flowchart TD
    subgraph ClientBrowser["Client Device (Browser / Node.js)"]
        UI["Application UI / React Components"]
        Hooks["@sovereigns3nc/react Hooks"]
        Repo["Repository<T> & Modules (Feed, DMs, Profile)"]
        
        subgraph CoreEngine["SovereignS3nc Core Engine"]
            Facade["SovereignS3nc Facade"]
            KeyMgr["KeyManager (X25519 & AES-256-GCM)"]
            SyncEngine["SyncEngine & Merkle Diffe"]
            ConflictMgr["ConflictManager & Diff Inspector"]
        end
        
        subgraph LocalStorage["Local Storage Layer"]
            Worker["Background Web Worker"]
            IDB["IndexedDB Storage Adapter"]
            SQLite["In-Browser SQLite WASM (sql.js)"]
        end
    end

    subgraph RemoteLayer["Remote Sync Transport Layer"]
        S3["S3 Remote Adapter (AWS / R2 / MinIO / RustFS)"]
        WebRTC["WebRTC Mesh Adapter (P2P Gossip Channels)"]
    end

    UI --> Hooks
    Hooks --> Repo
    Repo --> Facade
    Facade --> KeyMgr
    Facade --> SyncEngine
    Facade --> ConflictMgr
    SyncEngine --> Worker
    Worker --> IDB
    Worker --> SQLite
    SyncEngine --> S3
    SyncEngine --> WebRTC
```

---

## 🔒 Storage Partitioning & Security Isolation

To prevent third parties or malicious S3 bucket administrators from mapping data back to human identities, SovereignS3nc separates public and private data partitions using deterministic hashing.

```mermaid
flowchart LR
    subgraph RootPrefix["Bucket Root: ${appId}/"]
        subgraph PublicPartition["Public Partition: ${userId}/${storeId}/"]
            P1["public/user.json (Profile)"]
            P2["public/manifest.json (Merkle Tree)"]
            P3["public/modules/feed/{date}.db"]
            P4["public/blobs/{sha256}"]
        end
        
        subgraph PrivatePartition["Private Partition: ${hashedUserId}/${storeId}/"]
            PR1["private/sentinel.enc (Login Check)"]
            PR2["private/_keys.json (Encrypted Keypair)"]
            PR3["private/modules/notes/{date}.db"]
            PR4["private/blobs/{sha256}.enc"]
        end
    end
```

### Salted Hash Formula
The private partition key is derived as:
$$\text{hashedUserId} = \text{SHA-256}(\text{userId} + \text{appId} + \text{salt/serverSecret})$$

Without the master password or server secret, an attacker viewing the S3 bucket cannot correlate private records with the public profile.

---

## 🔄 Two-Way Synchronization Pipeline

Synchronization is executed asynchronously inside a dedicated Web Worker to avoid blocking UI rendering.

```mermaid
sequenceDiagram
    autonumber
    participant App as Application UI
    participant Engine as SovereignS3nc Engine
    participant Local as Local IDB / SQLite
    participant Remote as Remote Storage (S3 / WebRTC)

    Note over App,Local: Phase 1: Local-First Mutation
    App->>Engine: saveFile("private/notes/doc.json", data)
    Engine->>Local: Write to IndexedDB immediately
    Engine-->>App: Mutation Complete (Instant UI update)

    Note over Engine,Remote: Phase 2: Opportunistic Sync
    Engine->>Local: Compute local Merkle Root & file hashes
    Engine->>Remote: Fetch remote manifest.json / ETags
    
    alt Remote and Local Hashes Match
        Engine-->>App: Sync Complete (No-Op, zero transfer)
    else Remote Has Newer Timestamp / ETag
        Engine->>Remote: Download updated objects
        Engine->>Local: Merge changes (SQLite compaction)
    else Local Has Newer Unsynced Objects
        Engine->>Remote: Upload encrypted ciphertext + SHA-256
    else Conflicting Modifications Detected
        Engine->>Engine: Queue Unresolved Conflict
        Engine->>App: Emit 'conflict' event (Semantic Diff)
    end
```

---

## 🌲 Hierarchical Merkle Tree Diffing

When accounts store hundreds of daily SQLite databases or media attachments, fetching metadata for every remote key is slow and costly.

SovereignS3nc generates a hierarchical Merkle tree embedded in `public/manifest.json`:
1. Each file has a SHA-256 hash and ISO timestamp.
2. Directories and modules aggregate child hashes into node hashes.
3. The root hash represents the entire account state.

During synchronization, SovereignS3nc compares the top-level Merkle root first. If the root matches, the sync finishes in **a single HTTP roundtrip**. If hashes differ, it traverses only the affected subtree branches.

---

## 🌐 WebRTC Peer-to-Peer Mesh Gossip

In addition to S3 object storage, SovereignS3nc provides the `WebRTCRemoteAdapter`:
- Peers maintain direct `RTCDataChannel` connections.
- Multiple browser tabs communicate via `BroadcastChannel`.
- File writes trigger compact gossip state announcements containing file paths, hashes, and version vectors.
- Peers that fall behind request missing chunks directly over the peer mesh without hitting any central server.
