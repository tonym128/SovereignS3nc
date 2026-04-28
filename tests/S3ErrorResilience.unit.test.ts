
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Logger } from '../src/utils/Logger';

// Mock S3 Client
jest.mock('@aws-sdk/client-s3');

describe('S3RemoteAdapter Error Resilience', () => {
    let adapter: S3RemoteAdapter;
    let mockS3Client: any;

    beforeEach(() => {
        mockS3Client = {
            send: jest.fn()
        };
        (S3Client as jest.Mock).mockImplementation(() => mockS3Client);
        adapter = new S3RemoteAdapter({
            region: 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
            bucketName: 'test-bucket'
        }, { appId: 'app', userId: 'user', storeId: 'store' });
        
        // Silence logger for tests
        jest.spyOn(Logger, 'warn').mockImplementation(() => {});
        jest.spyOn(Logger, 'error').mockImplementation(() => {});
    });

    it('should retry on transient failures and eventually succeed', async () => {
        // Fail twice, succeed on third attempt
        mockS3Client.send
            .mockRejectedValueOnce(new Error('Transient Error'))
            .mockRejectedValueOnce(new Error('Networking Issue'))
            .mockResolvedValueOnce({ ETag: '"success-etag"' });

        const etag = await adapter.uploadFile('test.txt', new Uint8Array([1, 2, 3]));
        
        expect(etag).toBe('"success-etag"');
        expect(mockS3Client.send).toHaveBeenCalledTimes(3);
    });

    it('should not retry on terminal errors (403 Forbidden)', async () => {
        const terminalError = new Error('Access Denied');
        (terminalError as any).$metadata = { httpStatusCode: 403 };
        
        mockS3Client.send.mockRejectedValue(terminalError);

        await expect(adapter.uploadFile('test.txt', new Uint8Array([1, 2, 3])))
            .rejects.toThrow('Access Denied');
        
        expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries are exhausted', async () => {
        mockS3Client.send.mockRejectedValue(new Error('Persistent Failure'));

        await expect(adapter.uploadFile('test.txt', new Uint8Array([1, 2, 3])))
            .rejects.toThrow('Persistent Failure');
        
        // Default maxRetries is 3, so total 4 attempts (0, 1, 2, 3)
        expect(mockS3Client.send).toHaveBeenCalledTimes(4);
    });
});
