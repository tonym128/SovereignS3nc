export interface S3Config {
  region: string;
  endpoint?: string; // For custom providers like Garage or OCI
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  bucketName: string;
  forcePathStyle?: boolean; // Often needed for custom S3 implementations
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
  };
  encryptionKey?: string; // Private key (Runtime)
  publicEncryptionKey?: string; // Public key (Runtime)
  password?: string; // Used to decrypt the stored private key
  useManifest?: boolean; // Enable for "Blind Storage" (No List capability)
  autoFollowDiscoveredUsers?: boolean; // Default: true (set to false to disable auto-following everyone in global registry)
  debug?: boolean; // Enable verbose logging
}

export interface SovereignManifest {
    updatedAt: number;
    userId: string;
    modules: Record<string, string[]>; // moduleName -> [dateStr, ...]
    dms: Record<string, string[]>;     // recipientId -> [dateStr, ...]
    groups: Record<string, string[]>;  // groupId -> [dateStr, ...]
    profileHash?: string;
}

export interface GroupMember {
    userId: string;
    publicKey: string;
    role: 'owner' | 'admin' | 'member';
    status?: 'pending' | 'joined' | 'declined' | 'left';
}

export interface SovereignGroup {
    id: string;
    name: string;
    members: GroupMember[];
    sharedKey: string; // Symmetric key for group content
    createdAt: number;
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
}

