import { SovereignS3nc, IndexedDBStorage, SovereignConfig, SyncStats } from '../../../src/index';

let db: SovereignS3nc | null = null;

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        try {
            const config = payload as SovereignConfig;
            // Ensure we connect to the SAME IndexedDB as the main thread
            const storage = new IndexedDBStorage(config.paths.userId);
            await storage.init();
            
            db = new SovereignS3nc(config, storage);
            await db.init();
            
            // Connect remote adapter
            if (config.s3 || config.ociParUrl) {
                // Already handled in constructor via config, but explicit connect might be safer if config was partial
                // Constructor handles it.
            }
            
            self.postMessage({ type: 'INIT_COMPLETE' });

            // Run initial sync
            const stats = await db.sync();
            self.postMessage({ type: 'SYNC_COMPLETE', payload: stats });
        } catch (err) {
             self.postMessage({ type: 'ERROR', payload: String(err) });
        }
        
    } else if (type === 'SYNC') {
        if (!db) {
            self.postMessage({ type: 'ERROR', payload: 'Worker not initialized' });
            return;
        }
        try {
            const stats = await db.sync();
            self.postMessage({ type: 'SYNC_COMPLETE', payload: stats });
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: String(err) });
        }
    }
};
