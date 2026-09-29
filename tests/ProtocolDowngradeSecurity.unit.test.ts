import * as nacl from 'tweetnacl';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { AuthError } from '../src/utils/Errors';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

class MockRemote implements IRemoteAdapter {
    files = new Map<string, { data: Uint8Array; hash: string; etag: string }>();

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) return { data: null, etag: entry.etag, notModified: true };
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> { return Array.from(this.files.keys()).filter(k => k.startsWith(prefix)); }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('Protocol Downgrade Attack Security Regression Tests (Item 5)', () => {
    let SQL: any;
    let aliceS3: SovereignS3nc;
    let bobS3: SovereignS3nc;
    let aliceRemote: MockRemote;
    let bobRemote: MockRemote;
    let bobMessaging: MessagingModule;

    beforeAll(async () => {
        SQL = await initSqlJs();
        (globalThis as any).initSqlJs = initSqlJs;
    });

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        aliceRemote = new MockRemote();
        bobRemote = new MockRemote();

        aliceS3 = new SovereignS3nc(
            { paths: { appId: 'downgrade-test', userId: 'alice', storeId: 'main' }, password: 'alice-password-123' },
            aliceRemote
        );
        await aliceS3.init();

        bobS3 = new SovereignS3nc(
            { paths: { appId: 'downgrade-test', userId: 'bob', storeId: 'main' }, password: 'bob-password-456' },
            bobRemote
        );
        await bobS3.init();

        // Bob follows Alice with Alice's public key
        await bobS3.follow('alice', aliceS3.getConfig().publicEncryptionKey);

        bobMessaging = new MessagingModule(bobS3);
    });

    async function injectIncomingDMDatabase(
        recipientS3: SovereignS3nc,
        senderId: string,
        date: string,
        schema: string,
        insertSql: string,
        params: any[]
    ) {
        const db = new SQL.Database();
        db.exec(schema);
        db.run(insertSql, params);
        const binary = db.export();
        db.close();

        const path = recipientS3.getModulePath('messaging', `${senderId}/dms/${recipientS3.getConfig().paths.userId}/${date}.db`, 'followed');
        await recipientS3.getStorage().saveFile(path, binary);
    }

    test('default configuration defaults to v1 backward compatibility', () => {
        expect(bobMessaging.getMinProtocolVersion()).toBe('v1');
    });

    test('can set and get minimum protocol version via constructor and setters', async () => {
        const testS3 = new SovereignS3nc(
            { paths: { appId: 'downgrade-test', userId: 'charlie', storeId: 'main' }, password: 'charlie-pass' },
            new MockRemote()
        );
        await testS3.init();

        const customMessaging = new MessagingModule(testS3, { minProtocolVersion: 'v3' });
        expect(customMessaging.getMinProtocolVersion()).toBe('v3');

        customMessaging.setMinProtocolVersion('v2');
        expect(customMessaging.getMinProtocolVersion()).toBe('v2');

        customMessaging.setMinProtocolVersion('v1');
        expect(customMessaging.getMinProtocolVersion()).toBe('v1');
    });

    test('V3-only mode rejects V2 message with missing ephemeral_pk (downgrade attack)', async () => {
        const date = new Date().toISOString().split('T')[0];
        const sharedSecretV2 = aliceS3.deriveSharedSecret(bobS3.getConfig().publicEncryptionKey!);

        const messagePayload: Message = {
            id: 'msg-v2-downgrade',
            content: 'Sensitive message under V2 static key',
            timestamp: Date.now(),
            senderId: 'alice',
            recipientId: 'bob',
            status: 'sent'
        };
        const ciphertext = await aliceS3.encrypt(
            new TextEncoder().encode(JSON.stringify(messagePayload)),
            sharedSecretV2
        );

        // Inject message without ephemeral_pk
        await injectIncomingDMDatabase(
            bobS3,
            'alice',
            date,
            'CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB, ephemeral_pk TEXT);',
            'INSERT INTO messages (id, encrypted_data, ephemeral_pk) VALUES (?, ?, ?);',
            ['msg-v2-downgrade', ciphertext, null]
        );

        // Bob in V3-only mode must reject this message
        bobMessaging.setMinProtocolVersion('v3');
        const inboxV3 = await bobMessaging.getInboxMessages(1);
        expect(inboxV3.find(m => m.id === 'msg-v2-downgrade')).toBeUndefined();

        // But Bob in V2 mode or V1 mode accepts it
        bobMessaging.setMinProtocolVersion('v2');
        const inboxV2 = await bobMessaging.getInboxMessages(1);
        expect(inboxV2.find(m => m.id === 'msg-v2-downgrade')).toBeDefined();
        expect(inboxV2.find(m => m.id === 'msg-v2-downgrade')?.content).toBe('Sensitive message under V2 static key');
    });

    test('V3-only mode rejects message when ephemeral_pk column is stripped from SQLite schema', async () => {
        const date = new Date().toISOString().split('T')[0];
        const sharedSecretV2 = aliceS3.deriveSharedSecret(bobS3.getConfig().publicEncryptionKey!);

        const messagePayload: Message = {
            id: 'msg-stripped-col',
            content: 'Attacker stripped the entire ephemeral column',
            timestamp: Date.now(),
            senderId: 'alice',
            recipientId: 'bob',
            status: 'sent'
        };
        const ciphertext = await aliceS3.encrypt(
            new TextEncoder().encode(JSON.stringify(messagePayload)),
            sharedSecretV2
        );

        // Legacy table schema with NO ephemeral_pk column at all
        await injectIncomingDMDatabase(
            bobS3,
            'alice',
            date,
            'CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB);',
            'INSERT INTO messages (id, encrypted_data) VALUES (?, ?);',
            ['msg-stripped-col', ciphertext]
        );

        bobMessaging.setMinProtocolVersion('v3');
        const inboxV3 = await bobMessaging.getInboxMessages(1);
        expect(inboxV3.find(m => m.id === 'msg-stripped-col')).toBeUndefined();
    });

    test('V3-only mode rejects message when ephemeral key is corrupted/tampered without falling back to V2', async () => {
        const date = new Date().toISOString().split('T')[0];
        // Sender encrypted with V2 static key, but provides a bogus/random ephemeral key
        const sharedSecretV2 = aliceS3.deriveSharedSecret(bobS3.getConfig().publicEncryptionKey!);
        const bogusEphemeralKey = Buffer.from(nacl.box.keyPair().publicKey).toString('hex');

        const messagePayload: Message = {
            id: 'msg-bogus-ephemeral',
            content: 'Payload encrypted with V2, accompanied by wrong ephemeral key',
            timestamp: Date.now(),
            senderId: 'alice',
            recipientId: 'bob',
            status: 'sent'
        };
        const ciphertext = await aliceS3.encrypt(
            new TextEncoder().encode(JSON.stringify(messagePayload)),
            sharedSecretV2
        );

        await injectIncomingDMDatabase(
            bobS3,
            'alice',
            date,
            'CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB, ephemeral_pk TEXT);',
            'INSERT INTO messages (id, encrypted_data, ephemeral_pk) VALUES (?, ?, ?);',
            ['msg-bogus-ephemeral', ciphertext, bogusEphemeralKey]
        );

        // In V3 mode: V3 decrypt fails, and MUST NOT fall back to static V2 key
        bobMessaging.setMinProtocolVersion('v3');
        const inboxV3 = await bobMessaging.getInboxMessages(1);
        expect(inboxV3.find(m => m.id === 'msg-bogus-ephemeral')).toBeUndefined();

        // In V1/V2 mode: V3 decrypt fails, but falls back to V2 and decrypts
        bobMessaging.setMinProtocolVersion('v2');
        const inboxV2 = await bobMessaging.getInboxMessages(1);
        expect(inboxV2.find(m => m.id === 'msg-bogus-ephemeral')).toBeDefined();
    });

    test('V2 mode accepts valid V3 forward-secret messages and V2 HKDF messages but rejects V1 raw legacy messages', async () => {
        const date = new Date().toISOString().split('T')[0];

        // 1. Valid V3 message
        const { ephemeralPublicKey, sharedSecret: sharedV3 } = aliceS3.deriveEphemeralSharedSecret(bobS3.getConfig().publicEncryptionKey!);
        const v3Payload: Message = {
            id: 'msg-valid-v3',
            content: 'Forward secret message',
            timestamp: Date.now(),
            senderId: 'alice',
            recipientId: 'bob'
        };
        const ctV3 = await aliceS3.encrypt(new TextEncoder().encode(JSON.stringify(v3Payload)), sharedV3);

        // 2. V1 raw legacy message (pre-HKDF)
        const sharedV1 = aliceS3.deriveSharedSecret(bobS3.getConfig().publicEncryptionKey!, 'SovereignS3nc-DM-v1-raw');
        const v1Payload: Message = {
            id: 'msg-legacy-v1',
            content: 'Pre-HKDF legacy message',
            timestamp: Date.now(),
            senderId: 'alice',
            recipientId: 'bob'
        };
        const ctV1 = await aliceS3.encrypt(new TextEncoder().encode(JSON.stringify(v1Payload)), sharedV1);

        const db = new SQL.Database();
        db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB, ephemeral_pk TEXT);');
        db.run('INSERT INTO messages (id, encrypted_data, ephemeral_pk) VALUES (?, ?, ?);', ['msg-valid-v3', ctV3, ephemeralPublicKey]);
        db.run('INSERT INTO messages (id, encrypted_data, ephemeral_pk) VALUES (?, ?, ?);', ['msg-legacy-v1', ctV1, null]);
        const binary = db.export();
        db.close();

        const path = bobS3.getModulePath('messaging', `alice/dms/bob/${date}.db`, 'followed');
        await bobS3.getStorage().saveFile(path, binary);

        // Bob with V2 mode should accept V3, but reject V1
        bobMessaging.setMinProtocolVersion('v2');
        const inboxV2 = await bobMessaging.getInboxMessages(1);
        expect(inboxV2.find(m => m.id === 'msg-valid-v3')).toBeDefined();
        expect(inboxV2.find(m => m.id === 'msg-legacy-v1')).toBeUndefined();

        // Bob with V1 mode should accept both
        bobMessaging.setMinProtocolVersion('v1');
        const inboxV1 = await bobMessaging.getInboxMessages(1);
        expect(inboxV1.find(m => m.id === 'msg-valid-v3')).toBeDefined();
        expect(inboxV1.find(m => m.id === 'msg-legacy-v1')).toBeDefined();
    });

    test('attachment decryption rejects unencrypted or legacy attachments under V3 policy', async () => {
        bobMessaging.setMinProtocolVersion('v3');

        const rawImageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
        const imageBlobPath = 'public/blobs/unencrypted-attachment.png';
        await bobS3.getStorage().saveFile(`followed/alice/${imageBlobPath}`, rawImageBytes);

        const unencryptedMessage: Message = {
            id: 'msg-unencrypted-att',
            content: 'See attached',
            timestamp: Date.now(),
            senderId: 'alice',
            recipientId: 'bob',
            image: imageBlobPath
            // no imageEncryption metadata
        };

        // Under V3 policy, an unencrypted attachment is rejected
        await expect(bobMessaging.getMessageImage(unencryptedMessage)).rejects.toThrow(AuthError);

        // Under V1 policy, unencrypted attachment is returned as-is
        bobMessaging.setMinProtocolVersion('v1');
        const legacyResult = await bobMessaging.getMessageImage(unencryptedMessage);
        expect(legacyResult).toEqual(rawImageBytes);
    });

    test('valid V3 encrypted message and attachment succeeds under V3 policy', async () => {
        bobMessaging.setMinProtocolVersion('v3');

        const rawImageBytes = new Uint8Array([10, 20, 30, 40]);
        const imageBlobPath = 'public/blobs/v3-attachment.enc';

        const { ephemeralPublicKey, sharedSecret } = aliceS3.deriveEphemeralSharedSecret(bobS3.getConfig().publicEncryptionKey!);
        const encryptedImage = await aliceS3.encrypt(rawImageBytes, sharedSecret);

        await bobS3.getStorage().saveFile(`followed/alice/${imageBlobPath}`, encryptedImage);

        const v3Message: Message = {
            id: 'msg-valid-v3-att',
            content: 'Encrypted attachment',
            timestamp: Date.now(),
            senderId: 'alice',
            recipientId: 'bob',
            image: imageBlobPath,
            imageEncryption: {
                version: 1,
                ephemeralPublicKey
            }
        };

        const decryptedImage = await bobMessaging.getMessageImage(v3Message);
        expect(decryptedImage).toEqual(rawImageBytes);
    });
});
