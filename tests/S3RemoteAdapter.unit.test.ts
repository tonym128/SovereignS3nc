import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3', () => {
    const actual = jest.requireActual('@aws-sdk/client-s3');
    return {
        ...actual,
        S3Client: jest.fn().mockImplementation(() => ({
            send: jest.fn()
        })),
        PutObjectCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'PutObjectCommand' })),
        GetObjectCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'GetObjectCommand' })),
        HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'HeadObjectCommand' })),
        ListObjectsV2Command: jest.fn().mockImplementation((input) => ({ input, __type: 'ListObjectsV2Command' })),
        DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'DeleteObjectCommand' })),
        CreateMultipartUploadCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'CreateMultipartUploadCommand' })),
        UploadPartCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'UploadPartCommand' })),
        CompleteMultipartUploadCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'CompleteMultipartUploadCommand' })),
        AbortMultipartUploadCommand: jest.fn().mockImplementation((input) => ({ input, __type: 'AbortMultipartUploadCommand' }))
    };
});

describe('S3RemoteAdapter', () => {
    const config = {
        region: 'us-east-1',
        bucketName: 'test-bucket',
        endpoint: 'http://localhost:9000',
        credentials: {
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret'
        }
    };
    const paths = {
        appId: 'test-app',
        userId: 'test-user',
        storeId: 'test-store'
    };
    
    let adapter: S3RemoteAdapter;
    let mockS3Client: jest.Mocked<S3Client>;

    beforeEach(() => {
        jest.clearAllMocks();
        adapter = new S3RemoteAdapter(config, paths);
        mockS3Client = (S3Client as any).mock.results[0].value;
    });

    it('should initialize with correct prefix', () => {
        expect(adapter).toBeDefined();
    });

    it('should throw error for security violations in path', async () => {
        await expect(adapter.uploadFile('../evil.txt', new Uint8Array())).rejects.toThrow('Security Violation');
        await expect(adapter.downloadFile('some/../../evil.txt')).rejects.toThrow('Security Violation');
    });

    it('should upload a file', async () => {
        const data = new Uint8Array([1, 2, 3]);
        const path = 'test.txt';
        (mockS3Client.send as jest.Mock).mockResolvedValue({ ETag: 'test-etag' } as any);

        const etag = await adapter.uploadFile(path, data);
        
        expect(etag).toBe('test-etag');
        expect(mockS3Client.send).toHaveBeenCalled();
        const command = (mockS3Client.send.mock.calls[0][0] as any);
        expect(command.input.Bucket).toBe(config.bucketName);
        expect(command.input.Key).toBe(`${paths.appId}/${paths.userId}/${paths.storeId}/${path}`);
        expect(command.input.Body).toBe(data);
        expect(command.input.Metadata).toBeDefined();
        expect(command.input.Metadata?.hash).toBeDefined();
    });

    it('should download a file', async () => {
        const data = new Uint8Array([1, 2, 3]);
        const path = 'test.txt';
        const mockResponse = {
            Body: {
                transformToByteArray: async () => data
            },
            ETag: 'test-etag'
        };
        (mockS3Client.send as jest.Mock).mockResolvedValue(mockResponse as any);

        const result = await adapter.downloadFile(path);
        
        expect(result?.data).toEqual(data);
        expect(result?.etag).toBe('test-etag');
        expect(mockS3Client.send).toHaveBeenCalled();
        const command = (mockS3Client.send.mock.calls[0][0] as any);
        expect(command.input.Key).toBe(`${paths.appId}/${paths.userId}/${paths.storeId}/${path}`);
    });

    it('should handle 304 Not Modified', async () => {
        const path = 'test.txt';
        const error = new Error('Not Modified') as any;
        error.$metadata = { httpStatusCode: 304 };
        (mockS3Client.send as jest.Mock).mockRejectedValue(error);

        const result = await adapter.downloadFile(path, 'some-etag');
        
        expect(result?.notModified).toBe(true);
        expect(result?.etag).toBe('some-etag');
        expect(result?.data).toBeNull();
    });

    it('should get file hash from metadata', async () => {
        const path = 'test.txt';
        (mockS3Client.send as jest.Mock).mockResolvedValue({
            Metadata: { hash: 'test-hash' }
        } as any);

        const hash = await adapter.getFileHash(path);
        
        expect(hash).toBe('test-hash');
        expect(mockS3Client.send).toHaveBeenCalled();
    });

    it('should fallback to ETag if hash is missing', async () => {
        const path = 'test.txt';
        (mockS3Client.send as jest.Mock).mockResolvedValue({
            Metadata: {},
            ETag: 'test-etag'
        } as any);

        const hash = await adapter.getFileHash(path);
        
        expect(hash).toBe('test-etag');
    });

    it('should get file ETag', async () => {
        const path = 'test.txt';
        (mockS3Client.send as jest.Mock).mockResolvedValue({
            ETag: 'test-etag'
        } as any);

        const etag = await adapter.getFileEtag(path);
        expect(etag).toBe('test-etag');
    });

    it('should get specific metadata', async () => {
        const path = 'test.txt';
        (mockS3Client.send as jest.Mock).mockResolvedValue({
            Metadata: { 'custom-key': 'custom-value' }
        } as any);

        const value = await adapter.getFileMetadata(path, 'custom-key');
        expect(value).toBe('custom-value');
    });

    it('should list files', async () => {
        const prefix = 'logs/';
        (mockS3Client.send as jest.Mock).mockResolvedValue({
            Contents: [
                { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/logs/1.txt` },
                { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/logs/2.txt` }
            ],
            IsTruncated: false
        } as any);

        const files = await adapter.listFiles(prefix);
        
        expect(files).toEqual(['logs/1.txt', 'logs/2.txt']);
        expect(mockS3Client.send).toHaveBeenCalled();
    });

    it('should delete a file', async () => {
        const path = 'test.txt';
        (mockS3Client.send as jest.Mock).mockResolvedValue({} as any);

        await adapter.deleteFile(path);
        
        expect(mockS3Client.send).toHaveBeenCalled();
        const command = (mockS3Client.send.mock.calls[0][0] as any);
        expect(command.input.Key).toBe(`${paths.appId}/${paths.userId}/${paths.storeId}/${path}`);
    });

    it('should check if it can write', async () => {
        (mockS3Client.send as jest.Mock).mockResolvedValue({} as any);
        const canWrite = await adapter.canWrite('test');
        expect(canWrite).toBe(true);
    });

    it('should return false if it cannot write', async () => {
        const error = new Error('Forbidden') as any;
        error.$metadata = { httpStatusCode: 403 };
        (mockS3Client.send as jest.Mock).mockRejectedValue(error);
        
        const canWrite = await adapter.canWrite('test');
        expect(canWrite).toBe(false);
    });

    it('should purge all files under prefix', async () => {
        (mockS3Client.send as jest.Mock)
            .mockResolvedValueOnce({ // listFiles
                Contents: [
                    { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/1.txt` },
                    { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/2.txt` }
                ],
                IsTruncated: false
            } as any)
            .mockResolvedValue({} as any); // deleteFile

        await adapter.purge();
        
        // One call for listFiles, two calls for deleteFile
        expect(mockS3Client.send).toHaveBeenCalledTimes(3);
    });

    describe('S3 Resumable Multipart Uploads', () => {
        it('uses single PutObjectCommand when data size <= multipartThreshold', async () => {
            const data = new Uint8Array(100);
            (mockS3Client.send as jest.Mock).mockResolvedValue({ ETag: '"single-put-etag"' } as any);

            const etag = await adapter.uploadFile('small.bin', data);
            expect(etag).toBe('"single-put-etag"');
            expect(PutObjectCommand).toHaveBeenCalled();
            expect(CreateMultipartUploadCommand).not.toHaveBeenCalled();
        });

        it('initiates, chunks parts, and completes multipart upload when data size > multipartThreshold', async () => {
            const mpAdapter = new S3RemoteAdapter({
                ...config,
                multipartThreshold: 1000,
                multipartChunkSize: 500
            }, paths);
            const mpMockS3 = (S3Client as any).mock.results[(S3Client as any).mock.results.length - 1].value;

            // 1200 bytes will be chunked into: 500 + 500 + 200 = 3 parts
            const largeData = new Uint8Array(1200);
            largeData.fill(42);

            (mpMockS3.send as jest.Mock).mockImplementation(async (command: any) => {
                if (command.__type === 'CreateMultipartUploadCommand') {
                    return { UploadId: 'test-upload-123' };
                }
                if (command.__type === 'UploadPartCommand') {
                    return { ETag: `"part-${command.input.PartNumber}-etag"` };
                }
                if (command.__type === 'CompleteMultipartUploadCommand') {
                    return { ETag: '"completed-mp-etag"' };
                }
                return {};
            });

            const etag = await mpAdapter.uploadFile('large.bin', largeData);

            expect(etag).toBe('"completed-mp-etag"');
            expect(CreateMultipartUploadCommand).toHaveBeenCalledWith(expect.objectContaining({
                Bucket: 'test-bucket',
                Key: expect.stringContaining('large.bin')
            }));
            expect(UploadPartCommand).toHaveBeenCalledTimes(3);
            expect(CompleteMultipartUploadCommand).toHaveBeenCalledWith(expect.objectContaining({
                Bucket: 'test-bucket',
                UploadId: 'test-upload-123',
                MultipartUpload: {
                    Parts: [
                        { ETag: '"part-1-etag"', PartNumber: 1 },
                        { ETag: '"part-2-etag"', PartNumber: 2 },
                        { ETag: '"part-3-etag"', PartNumber: 3 }
                    ]
                }
            }));
            expect(AbortMultipartUploadCommand).not.toHaveBeenCalled();
        });

        it('aborts multipart upload if a part upload fails permanently', async () => {
            const mpAdapter = new S3RemoteAdapter({
                ...config,
                multipartThreshold: 1000,
                multipartChunkSize: 500
            }, paths);
            const mpMockS3 = (S3Client as any).mock.results[(S3Client as any).mock.results.length - 1].value;

            const largeData = new Uint8Array(1200);

            (mpMockS3.send as jest.Mock).mockImplementation(async (command: any) => {
                if (command.__type === 'CreateMultipartUploadCommand') {
                    return { UploadId: 'fail-upload-456' };
                }
                if (command.__type === 'UploadPartCommand') {
                    const err: any = new Error('Permanent network connection drop');
                    err.$metadata = { httpStatusCode: 403 }; // Status code 403 won't retry
                    throw err;
                }
                if (command.__type === 'AbortMultipartUploadCommand') {
                    return {};
                }
                return {};
            });

            await expect(mpAdapter.uploadFile('large-fail.bin', largeData)).rejects.toThrow('Permanent network connection drop');

            expect(AbortMultipartUploadCommand).toHaveBeenCalledWith(expect.objectContaining({
                Bucket: 'test-bucket',
                UploadId: 'fail-upload-456'
            }));
        });
    });
});

describe('S3RemoteAdapter — TLS enforcement', () => {
    const paths = { appId: 'app', userId: 'user', storeId: 'store' };
    const baseCredentials = { accessKeyId: 'k', secretAccessKey: 's' };

    it('allows https:// endpoints without restriction', () => {
        expect(() => new S3RemoteAdapter(
            { region: 'us-east-1', bucketName: 'b', endpoint: 'https://mys3.example.com', credentials: baseCredentials },
            paths
        )).not.toThrow();
    });

    it('allows http:// on localhost without warning (local dev)', () => {
        expect(() => new S3RemoteAdapter(
            { region: 'us-east-1', bucketName: 'b', endpoint: 'http://localhost:9000', credentials: baseCredentials },
            paths
        )).not.toThrow();
    });

    it('allows http:// on 127.x.x.x without error (local dev)', () => {
        expect(() => new S3RemoteAdapter(
            { region: 'us-east-1', bucketName: 'b', endpoint: 'http://127.0.0.1:9000', credentials: baseCredentials },
            paths
        )).not.toThrow();
    });

    it('throws NetworkError for http:// on a non-localhost endpoint (default requireTLS)', () => {
        const { NetworkError } = require('../src/utils/Errors');
        expect(() => new S3RemoteAdapter(
            { region: 'us-east-1', bucketName: 'b', endpoint: 'http://mys3.example.com', credentials: baseCredentials },
            paths
        )).toThrow(NetworkError);
    });

    it('throws NetworkError message mentioning requireTLS opt-out', () => {
        expect(() => new S3RemoteAdapter(
            { region: 'us-east-1', bucketName: 'b', endpoint: 'http://mys3.example.com', credentials: baseCredentials },
            paths
        )).toThrow('requireTLS: false');
    });

    it('does NOT throw for http:// non-localhost when requireTLS: false is set explicitly', () => {
        expect(() => new S3RemoteAdapter(
            { region: 'us-east-1', bucketName: 'b', endpoint: 'http://mys3.example.com', requireTLS: false, credentials: baseCredentials },
            paths
        )).not.toThrow();
    });

    it('allows no endpoint (AWS native) without any TLS check', () => {
        expect(() => new S3RemoteAdapter(
            { region: 'us-east-1', bucketName: 'b', credentials: baseCredentials },
            paths
        )).not.toThrow();
    });
});

