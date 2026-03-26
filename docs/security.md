# SovereignS3nc Security Whitepaper

## Introduction

SovereignS3nc is designed with a "security-first, zero-trust" philosophy regarding the storage backend. It assumes the S3 bucket (and the provider) is potentially malicious or compromised. All sensitive data is encrypted client-side before being transmitted, and private data paths are obscured to prevent metadata harvesting.

## Cryptographic Primitives

SovereignS3nc utilizes industry-standard cryptographic primitives via the Node.js `crypto` module (and its browser-compatible polyfills) and `tweetnacl`.

### 1. Identity and Diffie-Hellman (X25519)
- **Library**: `tweetnacl`
- **Algorithm**: X25519 (Curve25519)
- **Usage**:
    - **Persistent Identity**: Upon first initialization, SovereignS3nc generates a persistent X25519 key pair using `nacl.box.keyPair()`.
    - **Key Storage**: The private key is encrypted using the user's `masterKey` (derived from their password) and stored in the local `_keys` database and the remote `_keys.json` file.
    - **Direct Messaging (DM)**: DMs use an Elliptic Curve Diffie-Hellman (ECDH) key exchange. The `deriveSharedSecret` method uses `nacl.box.before(theirPublicKey, mySecretKey)` to compute a 32-byte shared secret. This secret is then used as a symmetric key for AES-256-GCM encryption of the message payload.

### 2. Key Derivation (PBKDF2)
- **Library**: Node.js `crypto.pbkdf2Sync`
- **Algorithm**: PBKDF2 with HMAC-SHA256
- **Parameters**:
    - **Iterations**: 1,000
    - **Key Length**: 32 bytes (256 bits)
    - **Salt**: Deterministic salts based on the `userId`.
        - `masterKey` salt: `${userId}-master`
        - `privateId` salt: `${userId}-private-id`
- **Usage**:
    - **Master Key**: Used to encrypt the persistent identity keys and the local/remote sentinel.
    - **Private ID (GUID)**: Used to obscure the path to private data on the remote storage.

### 3. Payload Encryption (AES-256-GCM)
- **Library**: Node.js `crypto.createCipheriv` / `crypto.createDecipheriv`
- **Algorithm**: AES-256 in Galois/Counter Mode (GCM)
- **Parameters**:
    - **Key Size**: 256 bits
    - **IV Size**: 12 bytes (randomly generated for every encryption)
    - **Auth Tag**: 16 bytes (standard for GCM)
- **Binary Format**: The encrypted payload is returned as a concatenated buffer: `[IV (12 bytes)] + [Auth Tag (16 bytes)] + [Encrypted Data]`.
- **Usage**: All files stored in 'private' namespaces and all DM payloads are encrypted using this scheme.

## Threat Model & Privacy Strategies

### Path-Hashing Strategy (Private GUID)
To prevent user enumeration and discovery of private data on public S3 buckets, SovereignS3nc employs a 'Private GUID' strategy.
- **Problem**: If data were stored at `/users/{userId}/private/`, any observer could list the bucket to see which users exist and how much private data they have.
- **Solution**: Private data is stored using the `privateId` derived via PBKDF2 from the user's password. The remote path becomes `/{appId}/{privateId}/{storeId}/`.
- **Impact**: Without the user's password, it is computationally infeasible to derive the `privateId`. An attacker looking at the S3 bucket sees a collection of random GUID-like strings and cannot link them to specific public user identities.

### Metadata Leakage Analysis
While payloads are encrypted, metadata leakage remains a risk in decentralized S3-based systems.

1.  **Daily DB Access Patterns**: SovereignS3nc uses a "Daily-DB" pattern where a new SQLite file is created and synced for each day of activity.
    - **Risk**: An observer (or the S3 provider) can see which days a user was active by looking at the timestamps of uploaded files.
    - **Mitigation**: Users can choose to "pad" their activity or use a proxy, but by default, the daily pattern is a trade-off for sync efficiency and conflict resolution.

2.  **File Sizes**: AES-GCM does not hide the length of the plaintext.
    - **Risk**: Encrypted file sizes might leak information about the content (e.g., a specific message length or image resolution).
    - **Mitigation**: Future versions may implement padding to standard block sizes.

3.  **Public Social Graph**: If a user follows another user, they must periodically pull that user's public data.
    - **Risk**: The S3 provider sees which IP addresses are pulling which public user directories, potentially mapping the social graph.
    - **Mitigation**: Use of VPNs, Tor, or specialized "S3-Proxy" nodes can help obscure these access patterns.

4.  **Public Profiles**: Data stored in the `public` namespace is unencrypted by design to allow discovery. Users must be aware that anything in a `public` module is visible to anyone who knows their `userId`.

## Password Verification (Sentinel)
SovereignS3nc does not store the user's password. Instead, it stores a "sentinel" file:
- **Path**: `private/sentinel.enc`
- **Content**: The string `SovereignSentinel` encrypted with the `masterKey`.
- **Verification**: On login, the library derives the `masterKey`, attempts to decrypt the sentinel, and checks the resulting string. This allows for both local (offline) and remote (new device) password verification without ever exposing the password to the storage layer.
