"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SyncWorkerEngine_1 = require("../src/worker/SyncWorkerEngine");
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const fake_indexeddb_1 = require("fake-indexeddb");
const crypto_1 = __importDefault(require("crypto"));
const sql_js_1 = __importDefault(require("sql.js"));
// --- Browser Polyfills for Testing ---
globalThis.indexedDB = new fake_indexeddb_1.IDBFactory();
globalThis.crypto = crypto_1.default.webcrypto;
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
globalThis.initSqlJs = sql_js_1.default;
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
    let engine;
    let messages = [];
    const postMessage = (msg) => messages.push(msg);
    beforeEach(() => {
        messages = [];
        engine = new SyncWorkerEngine_1.SyncWorkerEngine(postMessage);
        jest.clearAllMocks();
    });
    test('should handle INIT message', async () => {
        const config = {
            paths: { appId: 'test', userId: 'user', storeId: 'social' },
            password: 'pass'
        };
        await engine.handleMessage({ type: 'INIT', payload: config, id: 1 });
        expect(SovereignS3nc_1.SovereignS3nc).toHaveBeenCalled();
        const sovInstance = SovereignS3nc_1.SovereignS3nc.mock.results[0].value;
        expect(sovInstance.init).toHaveBeenCalled();
        expect(messages).toContainEqual({ id: 1, type: 'INIT_SUCCESS' });
    });
    test('should handle SYNC message', async () => {
        // Init first
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = SovereignS3nc_1.SovereignS3nc.mock.results[0].value;
        await engine.handleMessage({ type: 'SYNC', payload: { forceSync: true }, id: 2 });
        expect(sovInstance.sync).toHaveBeenCalledWith(true);
        expect(messages).toContainEqual({ id: 2, type: 'SYNC_SUCCESS' });
    });
    test('should handle REGISTER_MODULE message', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = SovereignS3nc_1.SovereignS3nc.mock.results[0].value;
        const moduleDef = { name: 'testModule', tables: [] };
        await engine.handleMessage({ type: 'REGISTER_MODULE', payload: moduleDef, id: 3 });
        expect(sovInstance.registerModule).toHaveBeenCalledWith(moduleDef);
        expect(messages).toContainEqual({ id: 3, type: 'REGISTER_MODULE_SUCCESS' });
    });
    test('should handle RESOLVE_CONFLICT message', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = SovereignS3nc_1.SovereignS3nc.mock.results[0].value;
        await engine.handleMessage({
            type: 'RESOLVE_CONFLICT',
            payload: { conflictId: 'c1', choice: 'remote' }
        });
        expect(sovInstance.resolveConflict).toHaveBeenCalledWith('c1', 'remote');
    });
    test('should forward update events', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = SovereignS3nc_1.SovereignS3nc.mock.results[0].value;
        const updateData = { moduleName: 'test', path: 'p' };
        sovInstance.emit('update', updateData);
        expect(messages).toContainEqual({ type: 'EVENT_UPDATE', payload: updateData });
    });
    test('should forward conflict events', async () => {
        await engine.handleMessage({ type: 'INIT', payload: {}, id: 1 });
        const sovInstance = SovereignS3nc_1.SovereignS3nc.mock.results[0].value;
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
//# sourceMappingURL=SyncWorkerEngine.unit.test.js.map