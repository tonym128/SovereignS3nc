# Security model and threat model

This document describes the security properties implemented by SovereignS3nc and the assumptions they depend on. It is a design description, not an independent cryptographic audit or a certification.

## Scope and security goals

SovereignS3nc is a client-side storage and synchronization library. Its security goals are to:

- Encrypt private partitions before remote upload.
- Encrypt direct-message payloads for the intended recipient using X25519, HKDF-SHA256, and AES-256-GCM.
- Keep DM attachment plaintext out of public remote blob storage.
- Detect modification of authenticated ciphertext and content-addressed blobs.
- Use TLS for remote S3 endpoints by default.

These goals apply to data after it reaches the library's encryption functions. Applications remain responsible for authenticating users, protecting runtime secrets, validating peer identity keys, and securing their own UI and deployment.

## Assets and trust boundaries

| Asset | Stored locally | Stored remotely |
| --- | --- | --- |
| Private module databases and files | Plaintext in the local storage adapter | AES-GCM ciphertext |
| DM text and application metadata | Plaintext in the sender's outbox and recipient's decrypted inbox | AES-GCM ciphertext; message IDs, recipient inbox path, date partition, ephemeral public key, and approximate payload size remain visible |
| DM attachments | Sender's plaintext copy in the private local store; recipient ciphertext may be cached | AES-GCM ciphertext in a public content-addressed blob and an encrypted sender-private backup |
| Public posts and public attachments | Plaintext | Plaintext |
| Identity keys and passwords | Runtime and local key-management state | Encrypted key records / password-derived private namespace, depending on configuration |
| Sync metadata | Local cache | Paths, object sizes, ETags, timestamps, public manifests, and public registry data may be visible |

The remote object store is outside the trusted computing base for confidentiality of encrypted payloads. The browser or Node.js process, local storage, application code, and cryptographic runtime are trusted. A compromised endpoint can read plaintext and keys while the user is active.

## Threats and mitigations

### Remote storage inspection or compromise

An object-store operator or someone with read access can inspect all objects available to that credential. Private database and DM payloads are encrypted client-side. DM attachments are encrypted with the same fresh ephemeral message key as their corresponding message before being written under `public/blobs/`.

The store can still learn object paths, approximate ciphertext sizes, update timing, and public social data. Content-addressed attachment paths hash the ciphertext, not the original image, but equal ciphertext objects can still be correlated if the same encrypted object is reused.

Sender-side DM attachment copies use random private object IDs, so their paths do not expose a plaintext content hash. Other private blobs created with the general content-addressed blob API use an unkeyed SHA-256 ID; if those paths appear in public manifests, they may permit content-guessing correlation.

### Public-key substitution

DM confidentiality depends on resolving the intended recipient's authentic X25519 public key. If the registry or the application's key-verification path accepts a substituted key, the sender can encrypt to an attacker-controlled key. Users do not currently get an out-of-band fingerprint verification flow in the DM API. Deployments should protect registry writes, validate signed records, and treat registry/key distribution as a trust boundary; high-assurance applications should add key-change warnings or fingerprint verification.

### Remote object tampering

AES-GCM authentication detects modification of private partitions and DM ciphertext when decrypted. Blob retrieval checks the content hash encoded in the blob path. These checks detect corruption, but do not provide a signed, globally consistent history: an attacker can delete objects, replay older valid data, or manipulate unsigned public data and manifests. Applications needing rollback resistance or authoritative public state need signed versioning or an external trust anchor.

### Network interception

S3 endpoints using `http://` are rejected by default except localhost. Applications can explicitly disable this check, so production configuration must keep TLS required. TLS protects transport; it does not hide metadata from the storage provider.

### Malicious or compromised client

An attacker controlling application JavaScript, a browser extension with sufficient access, the host process, or the device can capture plaintext before encryption or after decryption. End-to-end encryption does not protect against compromised endpoints, malicious dependencies, unsafe application logging, screenshots, or local backups.

### Credential theft and weak passwords

Password-derived keys are vulnerable to offline guessing if an attacker obtains the relevant encrypted key material. Use a high-entropy password and protect S3 credentials. The library does not provide account authentication or prevent a stolen S3 credential from deleting or replacing objects within its allowed scope.

### Public data exposure

Public feeds, profiles, registries, receipts, manifests, and public blobs are intentionally readable wherever their S3 policy permits. Do not place private or sensitive content in public modules. A private post must use the private data path; public content is not encrypted by default.

### Deletion and expiry

Deleting or expiring a message does not currently guarantee deletion of its attachment objects from every remote store or peer cache. Treat TTL as an application visibility/cleanup feature, not cryptographic erasure. Remote orphan-blob collection and deletion propagation need an explicit retention policy.

## Direct-message attachment format

For a new message with an attachment:

1. The sender creates a fresh ephemeral X25519 key pair and derives a 256-bit key with HKDF-SHA256 against the recipient's public key.
2. The attachment is encrypted with AES-256-GCM under that key. The encrypted bytes are content-addressed and stored under the sender's public blob namespace.
3. The encrypted message contains the opaque blob path and the ephemeral public key. The message payload itself is encrypted under the same derived key.
4. The recipient derives the same key from the ephemeral public key and their private identity key, fetches the ciphertext, verifies its content hash, and decrypts it.
5. The sender keeps a private copy for the outbox under a random private object ID. The private copy is encrypted when synchronized, and its path is not included in the transmitted DM payload.

Previously sent attachments may have been uploaded as plaintext public blobs. This change does not retroactively encrypt or delete those objects. Deployments should identify and remove old DM attachment objects according to their retention and recovery requirements. Legacy messages without attachment encryption metadata remain readable for compatibility and should be treated as publicly exposed if they point into a public blob namespace.

## Explicitly out of scope

- Availability against object deletion, account suspension, quota exhaustion, or network partition.
- Hiding access patterns, object sizes, timing, public social graphs, or public registry entries.
- Protecting plaintext stored by local adapters from a person or process with access to the device.
- Protecting against malicious application code or dependencies.
- Providing non-repudiation for arbitrary application data, rollback protection, or a complete secure group messaging protocol.
- Guaranteeing forward secrecy after device compromise. DM attachments and messages use per-message ephemeral keys, but there is no Double Ratchet, and recipients retain identity private keys and decrypted local data.

## Deployment guidance

- Keep `requireTLS` enabled for every non-local S3 endpoint.
- Scope S3 credentials to the required app, user, and public/private prefixes; avoid long-lived bucket-wide credentials in browser apps.
- Keep admin credentials out of client applications.
- Use strong account passwords and keep runtime secrets out of logs, URLs, and source control.
- Set retention and backup policies for both local stores and remote buckets.
- Treat public namespaces and all legacy DM attachment blobs as public data.

Report suspected security issues privately to the project maintainers before publishing exploit details.
