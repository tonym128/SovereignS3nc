"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const S3RemoteAdapter_1 = require("../src/adapters/S3RemoteAdapter");
const client_s3_1 = require("@aws-sdk/client-s3");
const Logger_1 = require("../src/utils/Logger");
// Mock S3 Client
jest.mock('@aws-sdk/client-s3');
describe('S3RemoteAdapter Error Resilience', () => {
    let adapter;
    let mockS3Client;
    beforeEach(() => {
        mockS3Client = {
            send: jest.fn()
        };
        client_s3_1.S3Client.mockImplementation(() => mockS3Client);
        adapter = new S3RemoteAdapter_1.S3RemoteAdapter({
            region: 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
            bucketName: 'test-bucket'
        }, { appId: 'app', userId: 'user', storeId: 'store' });
        // Silence logger for tests
        jest.spyOn(Logger_1.Logger, 'warn').mockImplementation(() => { });
        jest.spyOn(Logger_1.Logger, 'error').mockImplementation(() => { });
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
        terminalError.$metadata = { httpStatusCode: 403 };
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
//# sourceMappingURL=S3ErrorResilience.unit.test.js.map