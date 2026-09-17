# SovereignS3nc Formal Security Whitepaper & Threat Model

**Version**: 3.2.0  
**Status**: Formal Specification & Threat Model  
**Classification**: Public  

---

## 1. Executive Summary & Zero-Trust Architecture

SovereignS3nc provides decentralized, offline-first data storage and synchronization with zero trust placed in the remote storage layer. Whether deployed against AWS S3, MinIO, RustFS, Oracle OCI, or peer-to-peer WebRTC meshes, SovereignS3nc guarantees client-side confidentiality, data authenticity, cryptographic identity validation, and access privacy.

### Core Security Guarantees
1. **Zero-Trust Backend**: The S3 bucket and object store provider are assumed to be adversarial or compromised. Data at rest is authenticated and encrypted prior to network transmission.
2. **True End-to-End Encryption (E2EE)**: Asymmetric Elliptic-Curve Diffie-Hellman (X25519) with HKDF-SHA256 key derivation and AES-256-GCM authenticated payload encryption.
3. **Cryptographic Identity & Non-Repudiation**: Independent Ed25519 digital signatures secure global registry discovery, preventing unauthorized identity takeover.
4. **Metadata Isolation**: Deterministic PBKDF2-derived Private GUIDs obscure private storage paths, preventing user enumeration by untrusted bucket observers.
5. **Transport & Network Hardening**: Mandatory TLS enforcement for non-localhost S3 endpoints, Strict Content Security Policies (CSP), Subresource Integrity (SRI) for Web Workers, and token-bucket gossip backpressure.

---

## 2. Cryptographic Primitives & Specifications

SovereignS3nc employs modern, audited cryptographic primitives implemented via WebCrypto, Node.js `crypto`, and `tweetnacl`.

| Function | Primitive | Standard / Parameters | Purpose |
| :--- | :--- | :--- | :--- |
| **Identity & DH** | X25519 (Curve25519) | RFC 7748, 256-bit scalar multiplication | Persistent identity, E2EE key exchange |
| **Digital Signatures** | Ed25519 (EdDSA) | RFC 8032, SHA-512 | Registry entries, PEX trust verification |
| **Key Derivation** | HKDF-SHA256 | RFC 5869, Extract-and-Expand | X25519 shared secret to AES symmetric key |
| **Password KDF** | PBKDF2-HMAC-SHA256 | RFC 8018, 1,000 to 600,000 iterations | Master key, Sentinel, Private GUID, Backups |
| **Authenticated Encryption** | AES-256-GCM | NIST SP 800-38D, 12-byte IV, 16-byte Tag | Private partitions, DMs, Admin backups |
| **Hashing & Digests** | SHA-256 / SHA-384 | FIPS 180-4 | Content addressing, SRI verification |

### 2.1 E2EE Direct Messaging Pipeline
Direct Messages utilize ephemeral and persistent asymmetric key negotiation:
1. **Key Agreement**: Alice and Bob compute a raw 32-byte shared point on Curve25519:
   $$\sigma = \text{X25519}(sk_A, pk_B) = \text{X25519}(sk_B, pk_A)$$
2. **Key Derivation (HKDF)**: To avoid raw DH point usage, key material is expanded via HKDF-SHA256:
   $$K_{\text{DM}} = \text{HKDF-Expand}(\text{HKDF-Extract}(\text{salt}=\text{""}, \text{IKM}=\sigma), \text{info}=\text{"SovereignS3nc-DM-v2"}, L=32)$$
3. **Authenticated Encryption**: The message $P$ is encrypted with a fresh random 12-byte initialization vector $IV$:
   $$(C, T) = \text{AES-256-GCM}_{\text{Encrypt}}(K_{\text{DM}}, IV, P)$$
   Payload wire format: `[IV (12B)] + [Auth Tag (16B)] + [Ciphertext C]`

### 2.2 Backup Security Pipeline
Administrative backups export all local namespaces into single encrypted bundles:
- **KDF**: Password derived via PBKDF2-HMAC-SHA256 with 600,000 iterations and 16 bytes of cryptographically secure random salt.
- **Envelope Format**: Magic Header `SOV_BACKUP_V1 (13B)` + `Salt (16B)` + `IV (12B)` + `Auth Tag (16B)` + `Ciphertext`.

---

## 3. Formal STRIDE Threat Model

The threat model evaluates SovereignS3nc across six threat classifications under the STRIDE methodology.

```
+-----------------------------------------------------------------------------------------+
|                                    STRIDE Threat Matrix                                 |
+----------------------+---------------------------------+--------------------------------+
| Threat Category      | Adversary Capability            | SovereignS3nc Mitigation       |
+----------------------+---------------------------------+--------------------------------+
| Spoofing             | Malicious peer injects fake     | - Ed25519 signed registry      |
|                      | identity into global registry   | - PEX verified signature check |
|                      | or PEX mesh.                    | - Reject unauthorized peers    |
+----------------------+---------------------------------+--------------------------------+
| Tampering            | S3 provider or MITM modifies    | - AES-256-GCM auth tags        |
|                      | ciphertext, SQLite DBs, or      | - SQLite corruption recovery   |
|                      | worker script.                  | - Subresource Integrity (SRI)  |
+----------------------+---------------------------------+--------------------------------+
| Repudiation          | User claims they did not update | - Canonical signed registry    |
|                      | their public profile/key.       |   entries with timestamps      |
+----------------------+---------------------------------+--------------------------------+
| Information          | Observer inspects S3 bucket or  | - AES-256-GCM encryption       |
| Disclosure           | sniffs traffic to harvest user  | - PBKDF2 Private GUID paths    |
|                      | identity or plaintext.          | - S3 TLS enforcement (HTTPS)   |
|                      |                                 | - Strict CSP headers on demos  |
+----------------------+---------------------------------+--------------------------------+
| Denial of Service    | Flooding gossip mesh or         | - Token-bucket rate limiting   |
|                      | spamming global registry with   | - 5-minute registry cooldown   |
|                      | rapid updates.                  | - 2D TTL message expiration    |
+----------------------+---------------------------------+--------------------------------+
| Elevation of         | Non-admin member attempts to    | - Cryptographic group keys     |
| Privilege            | moderate or post in a group.    | - Granular permissions matrix  |
|                      |                                 |   (canPost, canModerate)       |
+----------------------+---------------------------------+--------------------------------+
```

### 3.1 Detailed Threat Analysis

#### 3.1.1 Spoofing & Sybil Attacks
- **Vulnerability**: In decentralized registries, an attacker could overwrite `users/{userId}.json` or inject rogue peers through Peer Exchange (PEX).
- **Mitigation**: Every registry update requires an Ed25519 digital signature over canonicalized JSON (`userId`, `publicKey`, `signingPublicKey`, `timestamp`). `PEX` messages are only accepted if sent by directly-connected peers or if accompanying Ed25519 signatures verify against known identities.

#### 3.1.2 Tampering & Data Integrity
- **Vulnerability**: An untrusted storage provider could tamper with SQLite daily databases or inject compromised worker scripts.
- **Mitigation**:
  - All private and DM files are authenticated using AES-256-GCM 128-bit authentication tags. Any byte mutation causes authentication failure and immediate abort.
  - SQLite database files that fail opening due to storage-level corruption are detected gracefully, logged, and isolated without crashing the application.
  - Background sync workers can be verified against an SRI hash (`sha384-...`) before execution.

#### 3.1.3 Information Disclosure & Metadata Leakage
- **Vulnerability**: Path traversal and bucket listing allows adversaries to discover active users.
- **Mitigation**:
  - **Private GUID**: Remote path is `/{appId}/{privateId}/{storeId}/` where `privateId = PBKDF2(password, userId + "-private-id")`. Without the password, bucket contents cannot be associated with any public user ID.
  - **TLS Enforcement**: `S3RemoteAdapter` throws `NetworkError` if an endpoint begins with `http://` unless explicitly disabled for localhost development.
  - **CSP Hardening**: Demo HTML files enforce `Content-Security-Policy` prohibiting unauthorized script sources and object embeds (`object-src 'none'`).

#### 3.1.4 Denial of Service (DoS) & Mesh Amplification
- **Vulnerability**: An adversary sends rapid gossip messages to trigger $O(n^2)$ network amplification.
- **Mitigation**:
  - **Token-Bucket Backpressure**: WebRTC channels enforce a strict rate limit (20 messages/second window) per peer via WeakMap accounting.
  - **Two-Dimensional TTL Enforcement**: Messages carry hop-count TTL decrement and a 30-second timestamp freshness limit (`MSG_MAX_AGE_MS = 30000`). Stale messages are discarded immediately.
  - **Registry Upload Cooldown**: `GlobalRegistry` throttles uploads to at most once per 5 minutes unless keys change.

#### 3.1.5 Elevation of Privilege (Group Governance)
- **Vulnerability**: Rogue group participants attempting to moderate posts or write to restricted group partitions.
- **Mitigation**: Group state maintains cryptographic group member lists with roles (`owner`, `admin`, `member`) and granular permissions (`canPost`, `canModerate`, `canInvite`). Feed post creation checks `canPost !== false`, and moderation deletion strictly validates that the actor is group owner/admin or possesses `canModerate: true`.

---

## 4. Cryptographic Proofs & Security Arguments

### 4.1 Confidentiality (IND-CCA2)
Let $\mathcal{AE} = (\text{Enc}, \text{Dec})$ be AES-256-GCM. Under the standard assumption that AES is a pseudorandom permutation (PRP), AES-GCM provides IND-CCA2 security as long as no IV is reused under the same key.
- **IV Uniqueness**: SovereignS3nc generates a fresh 96-bit cryptographic pseudorandom IV from `crypto.getRandomValues()` for every encryption operation. The probability of an IV collision under a single key within $2^{32}$ operations is bounded by $2^{-65}$, well below NIST collision limits.

### 4.2 Forward Secrecy & Key Ratcheting
Currently, direct messages use semi-static ECDH (each user uses their persistent identity key). While HKDF-SHA256 provides domain separation and key hygiene, compromise of Alice's private key allows passive retrospective decryption of stored DMs. 
- **Future Roadmap**: The next major protocol revision integrates a Double Ratchet mechanism (similar to Signal/Matrix) for ephemeral ratchet keys per conversation.

---

## 5. Security Checklist & Best Practices for Developers

1. **Always enable TLS**: Do not set `requireTLS: false` in production S3 configurations.
2. **Use Strong Passwords**: Because `masterKey` and `privateId` are PBKDF2-derived from the user password, password entropy directly dictates resilience against offline dictionary attacks.
3. **Specify Worker SRI Hashes**: When deploying `SyncWorkerProxy` in production, configure `workerIntegrity: "sha384-..."`.
4. **Configure Data Retention**: Prevent local storage exhaustion by supplying `retentionPolicy` with appropriate `maxDaysOwnData` and `maxDaysFollowedData`.
