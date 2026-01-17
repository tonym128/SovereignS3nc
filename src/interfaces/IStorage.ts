import { SyncDocument } from '../types';

export interface ILocalStorage {
  /**
   * Initialize the storage (e.g., load from disk, connect to DB)
   */
  init(): Promise<void>;

  /**
   * Save or update a document.
   */
  put(doc: SyncDocument, collection?: string): Promise<void>;

  /**
   * Retrieve a document by ID.
   */
  get(id: string, collection?: string): Promise<SyncDocument | null>;

  /**
   * List all documents. 
   * @param includeDeleted If true, return documents marked as _deleted.
   * @param collection Optional: filter by collection
   */
  list(includeDeleted?: boolean, collection?: string): Promise<SyncDocument[]>;

  /**
   * Get documents updated since a specific timestamp.
   * @param collection Optional: filter by collection
   */
  getChanges(since: number, collection?: string): Promise<SyncDocument[]>;

  /**
   * Bulk put for sync efficiency.
   * @param collection Optional: collection context for the docs
   */
  bulkPut(docs: SyncDocument[], collection?: string): Promise<void>;
}