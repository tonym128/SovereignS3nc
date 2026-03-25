
import { SyncWorkerProxy } from '../src/worker/SyncWorkerProxy';

// We can't easily unit test the actual Worker in Node environment
// but we can test the Proxy's logic and event emission.
describe('SyncWorkerProxy', () => {
    let proxy: SyncWorkerProxy;

    beforeEach(() => {
        proxy = new SyncWorkerProxy('mock-worker.js');
    });

    test('should track pending promises and resolve them on message', async () => {
        // @ts-ignore - access private for testing
        const mockWorker = {
            postMessage: (msg: any) => {
                // Simulate worker response
                setTimeout(() => {
                    // @ts-ignore
                    proxy.handleMessage({ data: { id: msg.id, type: 'INIT_SUCCESS', payload: {} } } as any);
                }, 10);
            },
            terminate: jest.fn(),
            onmessage: null as any,
            onerror: null as any
        };

        // @ts-ignore
        proxy.worker = mockWorker;

        const config: any = { paths: { appId: 'test', userId: 'alice', storeId: 'data' } };
        await proxy.init(config);
    });

    test('should emit update events from worker messages', (done) => {
        const payload = { moduleName: 'feed', path: 'public/2024-01-01.db' };
        
        proxy.on('update', (data) => {
            expect(data).toEqual(payload);
            done();
        });

        // @ts-ignore
        proxy.handleMessage({ data: { type: 'EVENT_UPDATE', payload } } as any);
    });
});
