"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const S3RemoteAdapter_1 = require("../src/adapters/S3RemoteAdapter");
const client_s3_1 = require("@aws-sdk/client-s3");
jest.mock('@aws-sdk/client-s3', () => {
    const actual = jest.requireActual('@aws-sdk/client-s3');
    return {
        ...actual,
        S3Client: jest.fn().mockImplementation(() => ({
            send: jest.fn()
        })),
        PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
        GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
        HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
        ListObjectsV2Command: jest.fn().mockImplementation((input) => ({ input })),
        DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input }))
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
    let adapter;
    let mockS3Client;
    beforeEach(() => {
        jest.clearAllMocks();
        adapter = new S3RemoteAdapter_1.S3RemoteAdapter(config, paths);
        mockS3Client = client_s3_1.S3Client.mock.results[0].value;
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
        mockS3Client.send.mockResolvedValue({ ETag: 'test-etag' });
        const etag = await adapter.uploadFile(path, data);
        expect(etag).toBe('test-etag');
        expect(mockS3Client.send).toHaveBeenCalled();
        const command = mockS3Client.send.mock.calls[0][0];
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
        mockS3Client.send.mockResolvedValue(mockResponse);
        const result = await adapter.downloadFile(path);
        expect(result?.data).toEqual(data);
        expect(result?.etag).toBe('test-etag');
        expect(mockS3Client.send).toHaveBeenCalled();
        const command = mockS3Client.send.mock.calls[0][0];
        expect(command.input.Key).toBe(`${paths.appId}/${paths.userId}/${paths.storeId}/${path}`);
    });
    it('should handle 304 Not Modified', async () => {
        const path = 'test.txt';
        const error = new Error('Not Modified');
        error.$metadata = { httpStatusCode: 304 };
        mockS3Client.send.mockRejectedValue(error);
        const result = await adapter.downloadFile(path, 'some-etag');
        expect(result?.notModified).toBe(true);
        expect(result?.etag).toBe('some-etag');
        expect(result?.data).toBeNull();
    });
    it('should get file hash from metadata', async () => {
        const path = 'test.txt';
        mockS3Client.send.mockResolvedValue({
            Metadata: { hash: 'test-hash' }
        });
        const hash = await adapter.getFileHash(path);
        expect(hash).toBe('test-hash');
        expect(mockS3Client.send).toHaveBeenCalled();
    });
    it('should fallback to ETag if hash is missing', async () => {
        const path = 'test.txt';
        mockS3Client.send.mockResolvedValue({
            Metadata: {},
            ETag: 'test-etag'
        });
        const hash = await adapter.getFileHash(path);
        expect(hash).toBe('test-etag');
    });
    it('should get file ETag', async () => {
        const path = 'test.txt';
        mockS3Client.send.mockResolvedValue({
            ETag: 'test-etag'
        });
        const etag = await adapter.getFileEtag(path);
        expect(etag).toBe('test-etag');
    });
    it('should get specific metadata', async () => {
        const path = 'test.txt';
        mockS3Client.send.mockResolvedValue({
            Metadata: { 'custom-key': 'custom-value' }
        });
        const value = await adapter.getFileMetadata(path, 'custom-key');
        expect(value).toBe('custom-value');
    });
    it('should list files', async () => {
        const prefix = 'logs/';
        mockS3Client.send.mockResolvedValue({
            Contents: [
                { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/logs/1.txt` },
                { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/logs/2.txt` }
            ],
            IsTruncated: false
        });
        const files = await adapter.listFiles(prefix);
        expect(files).toEqual(['logs/1.txt', 'logs/2.txt']);
        expect(mockS3Client.send).toHaveBeenCalled();
    });
    it('should delete a file', async () => {
        const path = 'test.txt';
        mockS3Client.send.mockResolvedValue({});
        await adapter.deleteFile(path);
        expect(mockS3Client.send).toHaveBeenCalled();
        const command = mockS3Client.send.mock.calls[0][0];
        expect(command.input.Key).toBe(`${paths.appId}/${paths.userId}/${paths.storeId}/${path}`);
    });
    it('should check if it can write', async () => {
        mockS3Client.send.mockResolvedValue({});
        const canWrite = await adapter.canWrite('test');
        expect(canWrite).toBe(true);
    });
    it('should return false if it cannot write', async () => {
        const error = new Error('Forbidden');
        error.$metadata = { httpStatusCode: 403 };
        mockS3Client.send.mockRejectedValue(error);
        const canWrite = await adapter.canWrite('test');
        expect(canWrite).toBe(false);
    });
    it('should purge all files under prefix', async () => {
        mockS3Client.send
            .mockResolvedValueOnce({
            Contents: [
                { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/1.txt` },
                { Key: `${paths.appId}/${paths.userId}/${paths.storeId}/2.txt` }
            ],
            IsTruncated: false
        })
            .mockResolvedValue({}); // deleteFile
        await adapter.purge();
        // One call for listFiles, two calls for deleteFile
        expect(mockS3Client.send).toHaveBeenCalledTimes(3);
    });
});
//# sourceMappingURL=S3RemoteAdapter.unit.test.js.map