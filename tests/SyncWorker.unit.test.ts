
import { SyncWorkerProxy } from '../src/worker/SyncWorkerProxy';

// We can't easily unit test the actual Worker in Node environment
// but we can test the Proxy's logic and event emission.
describe('SyncWorkerProxy', () => {
    let proxy: SyncWorkerProxy;
    let originalWorker: any;

    beforeEach(() => {
        proxy = new SyncWorkerProxy('mock-worker.js');
        originalWorker = (global as any).Worker;
    });

    afterEach(() => {
        (global as any).Worker = originalWorker;
        proxy.terminate();
    });

    test('should track pending promises and resolve them on message', async () => {
        const mockWorker = {
            postMessage: (msg: any) => {
                // Simulate worker response
                setTimeout(() => {
                    (proxy as any).handleMessage({ data: { id: msg.id, type: 'INIT_SUCCESS', payload: {} } } as any);
                }, 10);
            },
            terminate: jest.fn(),
            onmessage: null as any,
            onerror: null as any
        };

        (global as any).Worker = jest.fn().mockImplementation(() => mockWorker);

        const config: any = { paths: { appId: 'test', userId: 'alice', storeId: 'data' } };
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

        (proxy as any).handleMessage({ data: { type: 'EVENT_UPDATE', payload } } as any);
    });

    test('should timeout if worker does not respond', async () => {
        const mockWorker = {
            postMessage: jest.fn(),
            terminate: jest.fn(),
            onmessage: null as any,
            onerror: null as any
        };
        (global as any).Worker = jest.fn().mockImplementation(() => mockWorker);

        // Trigger worker creation
        proxy.init({} as any).catch(() => {});

        const promise = (proxy as any).sendMessage('SYNC', {}, 100);
        await expect(promise).rejects.toThrow('Worker request timed out');
    });

    test('should handle worker error without crashing if no listeners', async () => {
        const mockWorker = {
            postMessage: jest.fn(),
            terminate: jest.fn(),
            onmessage: null as any,
            onerror: null as any
        };
        (global as any).Worker = jest.fn().mockImplementation(() => mockWorker);

        // We don't await init here because it would timeout
        proxy.init({} as any).catch(() => {});
        
        // This should not throw even if we don't have an error listener
        expect(() => {
            (mockWorker as any).onerror(new Error('Test error'));
        }).not.toThrow();
    });

    test('should emit error event when worker fails', (done) => {
        const mockWorker = {
            postMessage: jest.fn(),
            terminate: jest.fn(),
            onmessage: null as any,
            onerror: null as any
        };
        (global as any).Worker = jest.fn().mockImplementation(() => mockWorker);

        proxy.on('error', (err) => {
            expect(err).toBeDefined();
            done();
        });

        proxy.init({} as any).catch(() => {});
        (mockWorker as any).onerror(new Error('Test error'));
    });
});
