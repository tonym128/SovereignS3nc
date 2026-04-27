
import { SovereignS3nc } from '../src/SovereignS3nc';
import { SovereignConfig } from '../src/types';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

describe('SovereignS3nc Ergonomics', () => {
    const config: SovereignConfig = {
        paths: {
            appId: 'ergonomics-test',
            userId: 'test-user',
            storeId: 'main'
        },
        password: 'test-password',
        offline: true
    };

    it('should initialize using static create() method without manual init() call', async () => {
        // We use create() which should handle both construction and initialization
        const sov = await SovereignS3nc.create(config);
        
        expect(sov).toBeInstanceOf(SovereignS3nc);
        
        // If init() was successful, storage should be accessible
        const storage = sov.getStorage();
        expect(storage).toBeDefined();
        
        // Keys should be initialized
        const actualConfig = sov.getConfig();
        expect(actualConfig.encryptionKey).toBeDefined();
        expect(actualConfig.publicEncryptionKey).toBeDefined();
    });

    it('should still allow manual constructor and init() for backward compatibility', async () => {
        const sov = new SovereignS3nc(config);
        await sov.init();
        
        expect(sov.getStorage()).toBeDefined();
        expect(sov.getConfig().encryptionKey).toBeDefined();
    });
});
