
import { SyncWorkerEngine, WorkerMessage } from '../src/worker/SyncWorkerEngine';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';
import initSqlJs from 'sql.js';

// --- Browser Polyfills for Testing ---
(globalThis as any).indexedDB = new IDBFactory();
(globalThis as any).crypto = crypto.webcrypto;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).initSqlJs = initSqlJs;

// Mock SovereignS3nc to avoid network calls
jest.mock('../src/SovereignS3nc', () => {
    const EventEmitter = require('events');
    return {
        SovereignS3nc: jest.fn().mockImplementation(() => {
            const emitter = new EventEmitter();
            return {
                on: emitter.on.bind(emitter),
                emit: emitter.emit.bind(emitter),
                init: jest.fn().mockResolvedValue(undefined),
                sync: jest.fn().mockResolvedValue(undefined),
                registerModule: jest.fn(),
                resolveConflict: jest.fn(),
                getConfig: jest.fn().mockReturnValue({ paths: { appId: 'test', userId: 'user', storeId: 'store' } })
            };
        })
    };
});

describe('SyncWorkerEngine', () => {
    let engine: SyncWorkerEngine;
    let messages: WorkerMessage[] = [];
    const postMessage = (msg: WorkerMessage) => messages.push(msg);

    beforeEach(() => {
        messages = [];
        engine = new SyncWorkerEngine(postMessage);
        jest.clearAllMocks();
    });

    test('should handle INIT message', async () => {
        const config = {
            paths: { appId: 'test', userId: 'user', storeId: 'social' },
            password: 'pass'
        };

        await engine.handleMessage({ type: 'INIT', payload: config, id: 1 });

        expect(SovereignS3nc).toHaveBeenCalled();
        const sovInstance = (SovereignS3nc as unknown as jest.Mock).mock.results[0].value;
        expect(sovInstance.init).toHaveBeenCalled();
        
        expect(messages).toContainEqual({ id: 1, type: 'INIT_SUCCESS' });
    });

    test('should handle SYNC message', async () => {
        // Init first
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = (SovereignS3nc as unknown as jest.Mock).mock.results[0].value;

        await engine.handleMessage({ type: 'SYNC', payload: { forceSync: true }, id: 2 });

        expect(sovInstance.sync).toHaveBeenCalledWith(true);
        expect(messages).toContainEqual({ id: 2, type: 'SYNC_SUCCESS' });
    });

    test('should handle REGISTER_MODULE message', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = (SovereignS3nc as unknown as jest.Mock).mock.results[0].value;

        const moduleDef = { name: 'testModule', tables: [] };
        await engine.handleMessage({ type: 'REGISTER_MODULE', payload: moduleDef, id: 3 });

        expect(sovInstance.registerModule).toHaveBeenCalledWith(moduleDef);
        expect(messages).toContainEqual({ id: 3, type: 'REGISTER_MODULE_SUCCESS' });
    });

    test('should handle RESOLVE_CONFLICT message', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = (SovereignS3nc as unknown as jest.Mock).mock.results[0].value;

        await engine.handleMessage({ 
            type: 'RESOLVE_CONFLICT', 
            payload: { conflictId: 'c1', choice: 'remote' } 
        });

        expect(sovInstance.resolveConflict).toHaveBeenCalledWith('c1', 'remote');
    });

    test('should forward update events', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = (SovereignS3nc as unknown as jest.Mock).mock.results[0].value;

        const updateData = { moduleName: 'test', path: 'p' };
        sovInstance.emit('update', updateData);

        expect(messages).toContainEqual({ type: 'EVENT_UPDATE', payload: updateData });
    });

    test('should forward conflict events', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = (SovereignS3nc as unknown as jest.Mock).mock.results[0].value;

        const conflictData = { id: 'c2', path: 'p2' };
        sovInstance.emit('conflict', conflictData);

        expect(messages).toContainEqual({ type: 'EVENT_CONFLICT', payload: conflictData });
    });

    test('should return error for SYNC if not initialized', async () => {
        await engine.handleMessage({ type: 'SYNC', payload: {}, id: 4 });

        expect(messages).toContainEqual({ 
            id: 4, 
            type: 'ERROR', 
            error: 'Sovereign instance not initialized in worker' 
        });
    });

    test('should handle TERMINATE message', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        await engine.handleMessage({ type: 'TERMINATE', id: 5 });

        expect(messages).toContainEqual({ id: 5, type: 'TERMINATED' });
        
        // Verify it is de-initialized
        await engine.handleMessage({ type: 'SYNC', payload: {}, id: 6 });
        expect(messages).toContainEqual({ 
            id: 6, 
            type: 'ERROR', 
            error: 'Sovereign instance not initialized in worker' 
        });
    });
});
