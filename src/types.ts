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
  ociParUrl?: string; // OCI Pre-Authenticated Request URL (alternative to S3 Config)
  paths: {
    appId: string;   // Unique GUID for the application
    userId: string;  // Unique GUID for the user
    storeId: string; // Unique GUID for the specific data store
  };
  syncIntervalMs?: number; // Auto-sync interval, 0 to disable
  localPersistencePath?: string; // Optional path for file-based persistence (if using a file adapter)
  conflictResolutionStrategy?: 'LastWriteWins' | 'Merge'; // Default: Merge
  encryptionKey?: string; // Optional: Enable transparent encryption
  useManifest?: boolean; // Enable for "Blind Storage" (No List capability)
}

export interface SyncDocument<T = any> {
  _id: string;
  _rev?: string; // Revision ID for conflict resolution (simple implementation)
  _updatedAt: number;
  _deleted?: boolean;
  _etag?: string; // S3 ETag for optimization
  collection?: string; // Optional: Namespace/Collection for the document
  data: T;
}

export interface RemoteChange {
  id: string; // The extracted document ID
  collection?: string; // The extracted collection
  key: string; // The full S3 key
  etag?: string;
  lastModified?: Date;
}

export interface SyncStats {
  pushed: number;
  pulled: number;
  errors: number;
}

export interface SovereignAddress {
  endpoint?: string;
  region: string;
  bucket: string;
  appId: string;
  userId: string;
}

export interface BlobMetadata {
  _id: string;
  name: string;
  size: number;
  contentType: string;
  hash?: string;
  createdAt: number;
  isEncrypted: boolean;
}
