# SovereignS3nc Data Model & Storage Schemes

This document defines the standardized naming schemes and schemas for both local and remote storage in SovereignS3nc.

## 1. Universal Path Schemes

SovereignS3nc uses a unified path structure across local and remote storage. 

### Remote Storage Paths
Remote paths depend on whether they are public or private:
- **Public**: `${appId}/${userId}/${storeId}/public/...`
- **Private**: `${appId}/${hashedUserId}/${storeId}/private/...`

The `${hashedUserId}` is a salted SHA-256 hash of the `userId`, `appId`, and a `serverSecret` (or password fallback).

### Core System Files
| Path | Type | Description | Schema/Format |
| :--- | :--- | :--- | :--- |
| `public/user.json` | Public | Public user profile | `Profile` (JSON) |
| `public/manifest.json`| Public | Discovery manifest of all user databases | `SovereignManifest` (JSON) |
| `private/sentinel.enc`| Private | Encrypted sentinel for offline login | Encrypted Binary |
| `private/_keys.json` | Private | Encrypted E2EE keypair | `EncryptedKeys` (JSON) |
| `users.json` | Global | Global discovery registry | `Array<{userId, publicKey}>` |

### Module Data
Modules use namespaced paths: `{type}/modules/{moduleName}/{subPath}`.

| Path | Type | Description | Format |
| :--- | :--- | :--- | :--- |
| `public/modules/{name}/{date}.db` | Public | Daily public module database | SQLite |
| `private/modules/{name}/{date}.db` | Private | Daily private module database | SQLite |
| `followed/{userId}/modules/{name}/{date}.db` | Local Cache | Cached database from followed user | SQLite |

### Social Module Specifics (Example)
| Path | Type | Description | Format |
| :--- | :--- | :--- | :--- |
| `public/modules/social/{date}.db` | Public | Public posts and likes | SQLite |
| `public/dms/{recipientId}/{ns}/{ts}.enc` | Public | Encrypted DM Inbox for recipient | Encrypted JSON |
| `private/outbox/{recipientId}/{ns}/{ts}.json` | Private | User's own sent messages | JSON |

### Media & Blobs
| Path | Type | Description | Format |
| :--- | :--- | :--- | :--- |
| `public/blobs/{sha256}` | Public | Public media files | Binary |
| `private/blobs/{sha256}` | Private | Encrypted private media | Binary (Encrypted) |

---

## 2. SQLite Schemas

### Social Module (`social`)

#### Table: `posts`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Unique post ID |
| `content` | TEXT | | Post body text |
| `timestamp` | INTEGER | | Unix timestamp (ms) |
| `userId` | TEXT | | Author's userId |
| `image` | TEXT | | Path to blob (e.g., `public/blobs/...`) |
| `parentId` | TEXT | | ID of parent post (for replies) |
| `parentUserId` | TEXT | | UserId of parent author |
| `isEdited` | INTEGER | DEFAULT 0 | 1 if edited |
| `isDeleted` | INTEGER | DEFAULT 0 | 1 if deleted (content is cleared) |

#### Table: `likes`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `postId` | TEXT | PRIMARY KEY (1/2) | ID of liked post |
| `userId` | TEXT | PRIMARY KEY (2/2) | ID of user who liked |
| `timestamp` | INTEGER | | Unix timestamp (ms) |

#### Table: `messages` (DMs)
Used in Outbox (Private) and Followed Inbox (Decrypted).
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Unique message ID |
| `content` | TEXT | | Message body text |
| `timestamp` | INTEGER | | Unix timestamp (ms) |
| `senderId` | TEXT | | Author's userId |
| `recipientId` | TEXT | | Recipient's userId |
| `image` | TEXT | | Path to blob |
| `isEdited` | INTEGER | DEFAULT 0 | 1 if edited |
| `isDeleted` | INTEGER | DEFAULT 0 | 1 if deleted |

#### Table: `messages` (Encrypted Public Transport)
Used in `public/modules/social/dms/{recipientId}/{date}.db`.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Unique message ID |
| `encrypted_data` | BLOB | | E2EE payload (JSON string encrypted via X25519/AES) |

---

## 3. JSON Schemas

### Public Profile (`public/user.json`)
```json
{
  "name": "Alice Smith",
  "bio": "Decentralization enthusiast",
  "avatar": "data:image/jpeg;base64,...",
  "updatedAt": 1710921600000,
  "userId": "alice-guid"
}
```

### Encrypted Keys (`private/_keys.json`)
Encrypted using a key derived from the user's password.
```json
{
  "privateKey": "hex-encoded-nacl-secret-key",
  "publicKey": "hex-encoded-nacl-public-key"
}
```
