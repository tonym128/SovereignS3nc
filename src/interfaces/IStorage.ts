import { SyncDocument } from '../types';

export interface ILocalStorage {
  /**
   * Initialize the storage (e.g., load from disk, connect to DB)
   */
  init(): Promise<void>;

  /**
   * Save or update a document.
   */
  put(doc: SyncDocument): Promise<void>;

  /**
   * Retrieve a document by ID.
   */
  get(id: string): Promise<SyncDocument | null>;

  /**
   * List all documents. 
   * @param includeDeleted If true, return documents marked as _deleted.
   */
  list(includeDeleted?: boolean): Promise<SyncDocument[]>;

  /**
   * Get documents updated since a specific timestamp.
   */
  getChanges(since: number): Promise<SyncDocument[]>;

  /**
   * Bulk put for sync efficiency.
   */
  bulkPut(docs: SyncDocument[]): Promise<void>;
}
