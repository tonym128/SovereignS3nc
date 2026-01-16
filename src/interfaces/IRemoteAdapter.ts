import { SyncDocument, RemoteChange } from '../types';

export interface IRemoteAdapter {
  put(doc: SyncDocument): Promise<string | undefined>; // Returns ETag
  get(id: string): Promise<SyncDocument | null>;
  listChanges(since: Date): Promise<RemoteChange[]>;
  delete(id: string): Promise<void>;
}
