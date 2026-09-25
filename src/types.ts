export interface S3Config {
  region: string;
  endpoint?: string; // For custom providers like RustFS or OCI
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  bucketName: string;
  forcePathStyle?: boolean; // Often needed for custom S3 implementations
  /**
   * When `true` (the default), an `http://` endpoint will throw a `NetworkError`
   * to prevent encrypted payloads from being transmitted over unencrypted channels.
   * Set to `false` for local development environments (e.g. RustFS on localhost).
   */
  requireTLS?: boolean;
  /**
   * Minimum payload size (in bytes) to trigger S3 multipart upload.
   * Defaults to 25MB (26,214,400 bytes).
   */
  multipartThreshold?: number;
  /**
   * Chunk size for each multipart upload part. Minimum 5MB (5,242,880 bytes).
   * Defaults to 5MB (5,242,880 bytes).
   */
  multipartChunkSize?: number;
}

export interface SovereignConfig {
  s3?: S3Config;
  offline?: boolean; // Flag for explicit offline-first initialization
  ociParUrl?: string; // OCI Pre-Authenticated Request URL (alternative to S3 Config)
  paths: {
    appId: string;   // Unique GUID for the application
    userId: string;  // Unique GUID for the user
    storeId: string; // Unique GUID for the specific data store
  };
  syncIntervalMs?: number; // Auto-sync interval, 0 to disable
  localPersistencePath?: string; // Optional path for file-based persistence (if using a file adapter)
  conflictResolutionStrategy?: 'LastWriteWins' | 'Merge'; // Default: Merge
  auth?: {
      privatePassphrase?: string;
      publicPassphrase?: string;
      publicSalt?: string;
      serverSecret?: string;
  };
  encryptionKey?: string; // Private key (Runtime)
  publicEncryptionKey?: string; // Public key (Runtime)
  password?: string; // Used to decrypt the stored private key
  useManifest?: boolean; // Enable for "Blind Storage" (No List capability)
  autoFollowDiscoveredUsers?: boolean; // Default: false (set to true to enable auto-following everyone in global registry)
  enablePeerExchange?: boolean; // If true, automatically tries to connect to peers of peers via existing connections
  blacklist?: string[]; // Global blacklist of User IDs to ignore
  adminPublicKey?: string; // Public key of the application admin for E2EE reports
  debug?: boolean; // Enable verbose logging
  useWorker?: boolean; // Enable background sync via Web Worker
  workerUrl?: string; // Path to the compiled worker.js
  /**
   * Optional SRI hash for the worker script (e.g. "sha256-abc123==").
   * When provided, the Worker will be loaded via a Blob URL after the script
   * content is fetched and verified against the hash, preventing supply-chain attacks.
   * Example: "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
   */
  workerIntegrity?: string;
  enableP2PPairing?: boolean; // Enable QR code and Bluetooth pairing functionality
  /** Configurable TTL in ms for caching followed users' manifest ETags to avoid network requests (default: 60000ms). */
  followManifestCacheTtlMs?: number;
  /** Configurable local data retention policy to prevent unbounded storage growth. */
  retentionPolicy?: RetentionPolicy;
}

/** Stable result returned from every sync attempt, including skipped attempts. */
export type SyncPhaseName =
  | 'remote_preflight' | 'preflight' | 'manifest_fetch' | 'own_data' | 'registration'
  | 'discovery' | 'followed_data' | 'groups' | 'blobs' | 'moderation'
  | 'manifest_publish' | 'retention' | 'checkpoint' | 'orchestration';

export interface SyncRunResult {
  runId: string;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  startedAt: number;
  completedAt: number;
  phases: SyncPhaseResult[];
  diagnostics: SyncDiagnostic[];
}

export interface SyncPhaseResult {
  name: SyncPhaseName;
  status: 'succeeded' | 'failed' | 'skipped';
  startedAt: number;
  completedAt: number;
  diagnosticCode?: 'SYNC_PHASE_FAILED';
  failedTasks?: number;
}

/** Machine-readable sync diagnostic. Codes are stable API; messages contain no remote error text or credentials. */
export interface SyncDiagnostic {
  code: 'SYNC_REMOTE_UNAVAILABLE' | 'SYNC_ALREADY_RUNNING' | 'SYNC_PHASE_FAILED';
  runId: string;
  timestamp: number;
  severity: 'warning' | 'error';
  phase?: SyncPhaseName;
  failedTasks?: number;
  message: string;
}

export interface SyncProgressEvent {
  stage: string;
  phase?: SyncPhaseName;
  done?: number;
  total?: number;
  runId?: string;
  state?: 'running' | 'succeeded' | 'failed';
}

export interface RetentionPolicy {
  /** Maximum number of days of own daily partition databases to keep locally. Older files are pruned. */
  maxDaysOwnData?: number;
  /** Maximum number of days of followed user data to keep locally. Older files are pruned. */
  maxDaysFollowedData?: number;
}

export interface SubManifestRef {
    path: string;      // Remote path, e.g. "manifests/2026.json" or "manifests/blobs.json"
    hash: string;      // SHA-256 hash of this sub-manifest
    count: number;     // Number of files or records in partition
    updatedAt: number; // Partition last update timestamp
}

export interface SubManifest {
    partitionKey: string;
    updatedAt: number;
    userId: string;
    modules?: Record<string, string[]>;
    dms?: Record<string, string[]>;
    groups?: Record<string, string[]>;
    receipts?: Record<string, string[]>;  // senderId -> [dateStr, ...]
    blobs?: string[];
    files?: Record<string, { hash: string, updatedAt: number }>;
}

export interface SovereignManifest {
    updatedAt: number;
    userId: string;
    merkleRoot?: string;                                // Top-level Merkle root hash of all sub-manifests
    subManifests?: Record<string, SubManifestRef>;      // Partition key -> SubManifestRef
    modules: Record<string, string[]>;                 // moduleName -> [dateStr, ...]
    dms: Record<string, string[]>;                     // recipientId -> [dateStr, ...]
    groups: Record<string, string[]>;                  // groupId -> [dateStr, ...]
    receipts?: Record<string, string[]>;               // senderId -> [dateStr, ...] for read receipt DBs
    blobs: string[];                                   // List of blob hashes or paths
    profileHash?: string;
    files?: Record<string, { hash: string, updatedAt: number }>;
}

export interface GroupPermissions {
    canPost?: boolean;
    canModerate?: boolean;
    canInvite?: boolean;
}

export interface GroupMember {
    userId: string;
    publicKey: string;
    role: 'owner' | 'admin' | 'member';
    status?: 'pending' | 'joined' | 'declined' | 'left';
    permissions?: GroupPermissions;
}

export interface SovereignGroup {
    id: string;
    name: string;
    members: GroupMember[];
    sharedKey: string; // Symmetric key for group content
    createdAt: number;
}

export interface DeviceInfo {
    deviceId: string;
    deviceName: string;
    registeredAt: number;
    lastSeenAt?: number;
    status: 'active' | 'revoked';
}

export interface DevicePairingPackage {
    version: 1;
    appId: string;
    userId: string;
    salt: string;
    iv: string;
    tag: string;
    ciphertext: string;
    createdAt: number;
    expiresAt: number;
}

export interface TableDefinition {
    name: string;
    schema: string; // "id TEXT PRIMARY KEY, content TEXT..."
}

export interface ModuleMigration {
    version: number;
    sql: string[];
}

export interface ModuleDefinition {
    name: string;
    tables: TableDefinition[];
    migrations?: ModuleMigration[];
}

export interface SovereignAddress {
  endpoint?: string;
  region: string;
  bucket: string;
  appId: string;
  userId: string;
  publicPassphrase?: string; // Optional: Required if the user uses Zero Knowledge encryption
  publicSalt?: string;
      serverSecret?: string;
}

export interface WebRTCSignalingData {
    type: 'offer' | 'answer' | 'candidate';
    sdp?: string;
    candidate?: RTCIceCandidateInit;
    senderId: string;
}

