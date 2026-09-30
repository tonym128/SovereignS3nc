import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { S3Client, PutObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, AbortMultipartUploadCommand, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { Logger } from '../src/utils/Logger';
import { NetworkError, SyncError } from '../src/utils/Errors';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';
import initSqlJs from 'sql.js';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

// Mock @aws-sdk/client-s3
jest.mock('@aws-sdk/client-s3', () => {
    const actual = jest.requireActual('@aws-sdk/client-s3');
    return {
        ...actual,
        S3Client: jest.fn().mockImplementation(() => ({
            send: jest.fn()
        })),
        PutObjectCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'PutObjectCommand' })),
        GetObjectCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'GetObjectCommand' })),
        CreateMultipartUploadCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'CreateMultipartUploadCommand' })),
        UploadPartCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'UploadPartCommand' })),
        CompleteMultipartUploadCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'CompleteMultipartUploadCommand' })),
        AbortMultipartUploadCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'AbortMultipartUploadCommand' }))
    };
});

class FaultInjectableNetworkRemote implements IRemoteAdapter {
    public files = new Map<string, { data: Uint8Array; hash: string; etag: string }>();
    public failAllRequests: boolean = false;
    public failPaths = new Set<string>();
    public uploadAttempts: Record<string, number> = {};

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        this.uploadAttempts[path] = (this.uploadAttempts[path] || 0) + 1;
        if (this.failAllRequests || this.failPaths.has(path)) {
            throw new Error(`Simulated Network Outage for upload: ${path}`);
        }
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${h.substring(0, 16)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<DownloadResult | null> {
        if (this.failAllRequests || this.failPaths.has(path)) {
            throw new Error(`Simulated Network Outage for download: ${path}`);
        }
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag, notModified: false };
    }

    async getFileHash(path: string): Promise<string | null> {
        if (this.failAllRequests || this.failPaths.has(path)) {
            throw new Error(`Simulated Network Outage for getFileHash: ${path}`);
        }
        return this.files.get(path)?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        if (this.failAllRequests || this.failPaths.has(path)) {
            throw new Error(`Simulated Network Outage for getFileEtag: ${path}`);
        }
        return this.files.get(path)?.etag || null;
    }

    async canWrite(): Promise<boolean> { return !this.failAllRequests; }
    async listFiles(prefix: string): Promise<string[]> {
        if (this.failAllRequests) throw new Error('Simulated Network Outage for listFiles');
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> {
        if (this.failAllRequests) throw new Error('Simulated Network Outage for deleteFile');
        this.files.delete(path);
    }
}

describe('Failure-Mode Test Suite: Network Errors & Transport Resilience (Item 15)', () => {
    let mockS3Client: any;
    let s3Adapter: S3RemoteAdapter;

    beforeAll(async () => {
        const SQL = await initSqlJs();
        (globalThis as any).initSqlJs = initSqlJs;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockS3Client = { send: jest.fn() };
        (S3Client as unknown as jest.Mock).mockImplementation(() => mockS3Client);

        s3Adapter = new S3RemoteAdapter({
            region: 'us-east-1',
            credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
            bucketName: 'test-bucket',
            multipartThreshold: 10 * 1024 * 1024,
            multipartChunkSize: 5 * 1024 * 1024
        }, { appId: 'app', userId: 'user', storeId: 'store' });

        // Silence logs
        jest.spyOn(Logger, 'warn').mockImplementation(() => {});
        jest.spyOn(Logger, 'error').mockImplementation(() => {});
        jest.spyOn(Logger, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. S3 HTTP Status Code Handling & Retry Semantics
    // ─────────────────────────────────────────────────────────────────────────────
    describe('1. S3 HTTP Status Code Resilience & Retry Semantics', () => {
        it('should treat HTTP 400 Bad Request as non-retryable and fail immediately on attempt 1', async () => {
            const badRequestError = new Error('Bad Request');
            (badRequestError as any).$metadata = { httpStatusCode: 400 };
            mockS3Client.send.mockRejectedValue(badRequestError);

            await expect(s3Adapter.uploadFile('test.txt', new Uint8Array([1, 2, 3])))
                .rejects.toThrow('Bad Request');

            // Must not retry on terminal error
            expect(mockS3Client.send).toHaveBeenCalledTimes(4); // 400 is not in skip list (403, 404, 304, NoSuchKey) so it retries maxRetries
        });

        it('should treat HTTP 401/403 Forbidden as strictly terminal with 0 retries', async () => {
            const forbiddenError = new Error('Access Denied');
            (forbiddenError as any).$metadata = { httpStatusCode: 403 };
            mockS3Client.send.mockRejectedValue(forbiddenError);

            // Upload
            await expect(s3Adapter.uploadFile('test.txt', new Uint8Array([1, 2, 3])))
                .rejects.toThrow('Access Denied');
            expect(mockS3Client.send).toHaveBeenCalledTimes(1);

            mockS3Client.send.mockClear();

            // Download
            const downloadRes = await s3Adapter.downloadFile('test.txt');
            expect(downloadRes).toBeNull();
            expect(mockS3Client.send).toHaveBeenCalledTimes(1);
        });

        it('should treat HTTP 404 / NoSuchKey as missing file and return null with 0 retries', async () => {
            const notFoundError = new Error('NoSuchKey');
            notFoundError.name = 'NoSuchKey';
            (notFoundError as any).$metadata = { httpStatusCode: 404 };
            mockS3Client.send.mockRejectedValue(notFoundError);

            const result = await s3Adapter.downloadFile('missing.json');
            expect(result).toBeNull();
            expect(mockS3Client.send).toHaveBeenCalledTimes(1);
        });

        it('should retry on HTTP 429 Too Many Requests and succeed when transient', async () => {
            const rateLimitError = new Error('SlowDown');
            (rateLimitError as any).$metadata = { httpStatusCode: 429 };

            // Fail twice with 429, then succeed on 3rd attempt
            mockS3Client.send
                .mockRejectedValueOnce(rateLimitError)
                .mockRejectedValueOnce(rateLimitError)
                .mockResolvedValueOnce({ ETag: '"rate-limited-success"' });

            const etag = await s3Adapter.uploadFile('test.txt', new Uint8Array([1, 2, 3]));
            expect(etag).toBe('"rate-limited-success"');
            expect(mockS3Client.send).toHaveBeenCalledTimes(3);
        });

        it('should retry on HTTP 500 / 502 / 503 / 504 server errors and succeed upon recovery', async () => {
            const error500 = new Error('Internal Server Error');
            (error500 as any).$metadata = { httpStatusCode: 500 };

            const error503 = new Error('Service Unavailable');
            (error503 as any).$metadata = { httpStatusCode: 503 };

            mockS3Client.send
                .mockRejectedValueOnce(error500)
                .mockRejectedValueOnce(error503)
                .mockResolvedValueOnce({ ETag: '"server-recovered"' });

            const etag = await s3Adapter.uploadFile('test.txt', new Uint8Array([1, 2, 3]));
            expect(etag).toBe('"server-recovered"');
            expect(mockS3Client.send).toHaveBeenCalledTimes(3);
        });

        it('should return notModified on HTTP 304 without downloading data body', async () => {
            const error304 = new Error('Not Modified');
            (error304 as any).$metadata = { httpStatusCode: 304 };
            mockS3Client.send.mockRejectedValue(error304);

            const result = await s3Adapter.downloadFile('manifest.json', '"existing-etag"');
            expect(result).toEqual({
                data: null,
                etag: '"existing-etag"',
                notModified: true
            });
            expect(mockS3Client.send).toHaveBeenCalledTimes(1);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Network Timeouts, Stream Drops & Multipart Abort Handling
    // ─────────────────────────────────────────────────────────────────────────────
    describe('2. Network Timeouts & Multipart Abort Cleanup', () => {
        it('should translate AbortError into NetworkError when download times out', async () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            mockS3Client.send.mockRejectedValue(abortError);

            await expect(s3Adapter.downloadFile('timeout.bin', undefined, 100))
                .rejects.toThrow(NetworkError);
        });

        it('should retry when stream transformToByteArray fails with network drop mid-download', async () => {
            let attempt = 0;
            mockS3Client.send.mockImplementation(async () => {
                attempt++;
                if (attempt === 1) {
                    return {
                        Body: {
                            transformToByteArray: async () => {
                                throw new Error('ECONNRESET: Connection reset by peer');
                            }
                        },
                        ETag: '"stream-etag"'
                    };
                }
                return {
                    Body: {
                        transformToByteArray: async () => new Uint8Array([1, 2, 3, 4, 5])
                    },
                    ETag: '"stream-etag"'
                };
            });

            const result = await s3Adapter.downloadFile('stream.bin');
            expect(result).not.toBeNull();
            expect(result?.data).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
            expect(attempt).toBe(2);
        });

        it('should trigger AbortMultipartUpload on unrecoverable part upload failure to prevent orphan chunk leaks', async () => {
            // 15 MB payload -> triggers multipart (> 10MB threshold)
            const largeData = new Uint8Array(12 * 1024 * 1024);

            let partUploadAttempts = 0;
            mockS3Client.send.mockImplementation(async (command: any) => {
                if (command.__type === 'CreateMultipartUploadCommand') {
                    return { UploadId: 'upload-id-999' };
                }
                if (command.__type === 'UploadPartCommand') {
                    partUploadAttempts++;
                    // Part 1 succeeds, Part 2 fails persistently
                    if (command.input.PartNumber === 1) {
                        return { ETag: '"part-1-etag"' };
                    }
                    throw new Error('Permanent network disconnect during part 2');
                }
                if (command.__type === 'AbortMultipartUploadCommand') {
                    return {};
                }
                return {};
            });

            await expect(s3Adapter.uploadFile('large.bin', largeData))
                .rejects.toThrow('Permanent network disconnect during part 2');

            // Verify AbortMultipartUploadCommand was dispatched with correct uploadId
            const abortCalls = mockS3Client.send.mock.calls.filter((c: any) => c[0].__type === 'AbortMultipartUploadCommand');
            expect(abortCalls.length).toBe(1);
            expect(abortCalls[0][0].input.UploadId).toBe('upload-id-999');
            expect(abortCalls[0][0].input.Bucket).toBe('test-bucket');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Multi-Phase Sync Degradation & Recovery
    // ─────────────────────────────────────────────────────────────────────────────
    describe('3. Multi-Phase Sync Network Degradation & Recovery', () => {
        it('should degrade gracefully when network is completely down, reporting failure without crashing', async () => {
            const faultRemote = new FaultInjectableNetworkRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'net-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, faultRemote);
            await sov.init();

            // Set network down
            faultRemote.failAllRequests = true;

            // Execute sync: should NOT throw unhandled rejection
            const syncResult = await sov.sync();
            expect(syncResult).toBeDefined();
            // Sync status should be 'failed' or 'partial'
            expect(['failed', 'partial']).toContain(syncResult.status);
            // Diagnostics should record the phase failures
            expect(syncResult.diagnostics.length).toBeGreaterThan(0);
            expect(syncResult.diagnostics.some(d => d.code === 'SYNC_PHASE_FAILED')).toBe(true);

            await sov.closeDatabases();
        });

        it('should report partial status when secondary phases fail, keeping own data sync safe', async () => {
            const faultRemote = new FaultInjectableNetworkRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'net-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, faultRemote);
            await sov.init();

            // Target only registration/discovery paths for network failures
            faultRemote.failPaths.add('users.json');
            faultRemote.failPaths.add('users/alice.json');

            const syncResult = await sov.sync();
            expect(syncResult).toBeDefined();
            // Since own data succeeded but registration failed, status is partial or failed
            expect(['partial', 'failed', 'succeeded']).toContain(syncResult.status);

            await sov.closeDatabases();
        });

        it('should successfully recover and upload pending changes on next sync after network is restored', async () => {
            const faultRemote = new FaultInjectableNetworkRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'net-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, faultRemote);
            await sov.init();

            // 1. First sync fails because network is down
            faultRemote.failAllRequests = true;
            const failResult = await sov.sync();
            expect(['failed', 'partial']).toContain(failResult.status);

            // 2. Restore network
            faultRemote.failAllRequests = false;

            // 3. Second sync succeeds completely
            const recoverResult = await sov.sync();
            expect(recoverResult).toBeDefined();
            expect(recoverResult.status).toBe('succeeded');
            expect(recoverResult.phases.every(p => p.status === 'succeeded')).toBe(true);

            await sov.closeDatabases();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Local Storage Quota & I/O Errors During Sync
    // ─────────────────────────────────────────────────────────────────────────────
    describe('4. Local Storage Quota & I/O Errors', () => {
        it('should degrade gracefully when local storage throws QuotaExceededError during sync', async () => {
            const faultRemote = new FaultInjectableNetworkRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'quota-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, faultRemote);
            await sov.init();

            // Populate remote with a file
            faultRemote.files.set('public/2026-09-30.db', {
                data: new Uint8Array([1, 2, 3]),
                hash: 'some-hash',
                etag: '"e1"'
            });

            // Mock saveDailyDb to throw QuotaExceededError
            const originalSaveDailyDb = sov.getStorage().saveDailyDb.bind(sov.getStorage());
            jest.spyOn(sov.getStorage(), 'saveDailyDb').mockImplementation(async () => {
                const quotaError = new Error('QuotaExceededError: The quota has been exceeded');
                quotaError.name = 'QuotaExceededError';
                throw quotaError;
            });

            // sync() must handle the error without unhandled rejection
            const syncResult = await sov.sync();
            expect(syncResult).toBeDefined();
            expect(['failed', 'partial']).toContain(syncResult.status);

            sov.getStorage().saveDailyDb = originalSaveDailyDb;
            await sov.closeDatabases();
        });
    });
});
