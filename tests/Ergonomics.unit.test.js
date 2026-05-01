"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const fake_indexeddb_1 = require("fake-indexeddb");
const crypto_1 = __importDefault(require("crypto"));
// --- Polyfills ---
global.indexedDB = new fake_indexeddb_1.IDBFactory();
global.crypto = crypto_1.default.webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
describe('SovereignS3nc Ergonomics', () => {
    const config = {
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
        const sov = await SovereignS3nc_1.SovereignS3nc.create(config);
        expect(sov).toBeInstanceOf(SovereignS3nc_1.SovereignS3nc);
        // If init() was successful, storage should be accessible
        const storage = sov.getStorage();
        expect(storage).toBeDefined();
        // Keys should be initialized
        const actualConfig = sov.getConfig();
        expect(actualConfig.encryptionKey).toBeDefined();
        expect(actualConfig.publicEncryptionKey).toBeDefined();
    });
    it('should still allow manual constructor and init() for backward compatibility', async () => {
        const sov = new SovereignS3nc_1.SovereignS3nc(config);
        await sov.init();
        expect(sov.getStorage()).toBeDefined();
        expect(sov.getConfig().encryptionKey).toBeDefined();
    });
});
//# sourceMappingURL=Ergonomics.unit.test.js.map