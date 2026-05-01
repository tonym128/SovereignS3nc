"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SyncWorkerProxy_1 = require("../src/worker/SyncWorkerProxy");
// We can't easily unit test the actual Worker in Node environment
// but we can test the Proxy's logic and event emission.
describe('SyncWorkerProxy', () => {
    let proxy;
    let originalWorker;
    beforeEach(() => {
        proxy = new SyncWorkerProxy_1.SyncWorkerProxy('mock-worker.js');
        originalWorker = global.Worker;
    });
    afterEach(() => {
        global.Worker = originalWorker;
        proxy.terminate();
    });
    test('should track pending promises and resolve them on message', async () => {
        const mockWorker = {
            postMessage: (msg) => {
                // Simulate worker response
                setTimeout(() => {
                    // @ts-ignore
                    proxy.handleMessage({ data: { id: msg.id, type: 'INIT_SUCCESS', payload: {} } });
                }, 10);
            },
            terminate: jest.fn(),
            onmessage: null,
            onerror: null
        };
        global.Worker = jest.fn().mockImplementation(() => mockWorker);
        const config = { paths: { appId: 'test', userId: 'alice', storeId: 'data' } };
        await proxy.init(config);
        expect(mockWorker.onmessage).toBeDefined();
        expect(mockWorker.onerror).toBeDefined();
    });
    test('should emit update events from worker messages', (done) => {
        const payload = { moduleName: 'feed', path: 'public/2024-01-01.db' };
        proxy.on('update', (data) => {
            expect(data).toEqual(payload);
            done();
        });
        // @ts-ignore
        proxy.handleMessage({ data: { type: 'EVENT_UPDATE', payload } });
    });
    test('should timeout if worker does not respond', async () => {
        const mockWorker = {
            postMessage: jest.fn(),
            terminate: jest.fn(),
            onmessage: null,
            onerror: null
        };
        global.Worker = jest.fn().mockImplementation(() => mockWorker);
        // Trigger worker creation
        proxy.init({}).catch(() => { });
        // @ts-ignore
        const promise = proxy.sendMessage('SYNC', {}, 100);
        await expect(promise).rejects.toThrow('Worker request timed out');
    });
    test('should handle worker error without crashing if no listeners', async () => {
        const mockWorker = {
            postMessage: jest.fn(),
            terminate: jest.fn(),
            onmessage: null,
            onerror: null
        };
        global.Worker = jest.fn().mockImplementation(() => mockWorker);
        // We don't await init here because it would timeout
        proxy.init({}).catch(() => { });
        // This should not throw even if we don't have an error listener
        expect(() => {
            // @ts-ignore
            mockWorker.onerror(new Error('Test error'));
        }).not.toThrow();
    });
    test('should emit error event when worker fails', (done) => {
        const mockWorker = {
            postMessage: jest.fn(),
            terminate: jest.fn(),
            onmessage: null,
            onerror: null
        };
        global.Worker = jest.fn().mockImplementation(() => mockWorker);
        proxy.on('error', (err) => {
            expect(err).toBeDefined();
            done();
        });
        proxy.init({}).catch(() => { });
        // @ts-ignore
        mockWorker.onerror(new Error('Test error'));
    });
});
//# sourceMappingURL=SyncWorker.unit.test.js.map