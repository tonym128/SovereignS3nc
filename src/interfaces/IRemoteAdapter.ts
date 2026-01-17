import { SyncDocument, RemoteChange } from '../types';

export interface IRemoteAdapter {
  put(doc: SyncDocument, collection?: string): Promise<string | undefined>; // Returns ETag
  get(id: string, collection?: string): Promise<SyncDocument | null>;
  listChanges(since: Date, collection?: string): Promise<RemoteChange[]>;
  delete(id: string, collection?: string): Promise<void>;
}
