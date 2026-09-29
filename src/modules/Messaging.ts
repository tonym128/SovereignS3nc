import { SovereignS3nc } from '../SovereignS3nc';
import { IModuleContext } from '../interfaces/IModuleContext';
import { Logger } from '../utils/Logger';
import { env } from '../utils/Environment';
import { ModuleError, AuthError } from '../utils/Errors';
import { DEFAULTS } from '../utils/Constants';
import { DailyDatabase } from '../core/DailyDatabase';

export interface Message {
    id: string;
    content: string;
    timestamp: number;
    senderId: string;
    recipientId: string;
    image?: string;
    /** Metadata needed to decrypt a DM attachment stored as public ciphertext. */
    imageEncryption?: { version: 1; ephemeralPublicKey: string };
    /** Sender-only local plaintext attachment path. Never included in the encrypted wire payload. */
    localImage?: string;
    isEdited?: boolean;
    isDeleted?: boolean;
    status?: 'sent' | 'delivered' | 'read';
    /** Optional expiration timestamp (Unix ms). Messages past this time are purged by cleanupExpired(). */
    expiresAt?: number;
}

export type MessagingProtocolVersion = 'v1' | 'v2' | 'v3';

export interface MessagingOptions {
    /**
     * Minimum messaging encryption protocol version to accept:
     * - 'v3': Requires forward-secret ephemeral public key (rejects V1/V2 downgrade attacks)
     * - 'v2': Requires HKDF-derived shared secret (rejects V1 raw legacy downgrade attacks)
     * - 'v1': Allows all legacy formats (default for backward compatibility)
     */
    minProtocolVersion?: MessagingProtocolVersion;
}

export class MessagingModule {
    private readonly MODULE_NAME = 'messaging';
    private context: IModuleContext;
    private dailyDb: DailyDatabase;
    private options: MessagingOptions;

    constructor(contextOrDb: IModuleContext | SovereignS3nc, options?: MessagingOptions) {
        this.context = 'sovereign' in contextOrDb
            ? (contextOrDb as IModuleContext)
            : (contextOrDb as SovereignS3nc).createModuleContext(this.MODULE_NAME);
        this.options = {
            minProtocolVersion: options?.minProtocolVersion ?? 'v1',
            ...options
        };
        this.context.registerDefinition({
            name: this.MODULE_NAME,
            tables: [
                {
                    name: 'messages',
                    schema: `
                        id TEXT PRIMARY KEY,
                        content TEXT,
                        timestamp INTEGER,
                        senderId TEXT,
                        recipientId TEXT,
                        image TEXT,
                        isEdited INTEGER DEFAULT 0,
                        isDeleted INTEGER DEFAULT 0
                    `
                }
            ],
            migrations: [
                {
                    version: 2,
                    sql: ['ALTER TABLE messages ADD COLUMN status TEXT DEFAULT "sent";']
                },
                {
                    version: 3,
                    sql: ['ALTER TABLE messages ADD COLUMN expiresAt INTEGER DEFAULT NULL;']
                },
                {
                    version: 4,
                    sql: ['ALTER TABLE messages ADD COLUMN localImage TEXT DEFAULT NULL;']
                },
                {
                    version: 5,
                    sql: ['ALTER TABLE messages ADD COLUMN imageEphemeralPk TEXT DEFAULT NULL;']
                }
            ]
        });
        this.dailyDb = this.context.getDailyDatabase({ debounceMs: 500 });
        this.context.registerInstance(this);
    }

    public get db(): SovereignS3nc {
        return this.context.sovereign;
    }

    public get sovereign(): SovereignS3nc {
        return this.context.sovereign;
    }

    /**
     * Set the minimum accepted protocol version.
     */
    setMinProtocolVersion(version: MessagingProtocolVersion): void {
        this.options.minProtocolVersion = version;
    }

    /**
     * Get the current minimum accepted protocol version.
     */
    getMinProtocolVersion(): MessagingProtocolVersion {
        return this.options.minProtocolVersion ?? 'v1';
    }

    /**
     * Send a direct encrypted message to a recipient.
     * @param recipientId - Target user's ID
     * @param content - Message text
     * @param image - Optional image blob
     * @param expiresAt - Optional Unix timestamp (ms) after which the message should be purged
     */
    async sendDirectMessage(recipientId: string, content: string, image?: Uint8Array, expiresAt?: number) {
        if (content.length > DEFAULTS.MAX_MESSAGE_LENGTH) {
            throw new ModuleError('messaging', `Message exceeds maximum length of ${DEFAULTS.MAX_MESSAGE_LENGTH} characters`);
        }
        
        const date = new Date().toISOString().split('T')[0];
        const id = env.generateId(12);
        const timestamp = Date.now();
        const senderId = this.context.userId;

        const message: Message = { id, content, timestamp, senderId, recipientId, isEdited: false, isDeleted: false, status: 'sent', expiresAt };
        await this._saveAndSendDM(recipientId, message, date, image);
    }

    private async _saveAndSendDM(recipientId: string, message: Message, date: string, image?: Uint8Array) {
        const registry = await this.context.getPublicRegistry();
        let recipient = registry.find(u => u.userId === recipientId);
        if (!recipient) {
            const following = await this.context.getFollowing();
            const f = following.find(u => u.userId === recipientId);
            if (f?.publicKey) recipient = { userId: f.userId, publicKey: f.publicKey };
        }
        if (!recipient?.publicKey) throw new AuthError('Recipient public key not found');

        // Use one fresh per-message key for both the payload and its optional attachment.
        const { ephemeralPublicKey, sharedSecret } = this.context.deriveEphemeralSharedSecret(recipient.publicKey);
        let outgoing: Message = { ...message };
        let localImage: string | undefined;
        if (image?.byteLength) {
            const encryptedImage = await this.context.encrypt(image, sharedSecret);
            outgoing.image = await this.context.saveBlob(encryptedImage, true);
            outgoing.imageEncryption = { version: 1, ephemeralPublicKey };
            localImage = `private/dm-attachments/${env.generateId(32)}`;
            await this.context.storage.raw.saveFile(localImage, image);
        }

        // 1. Save to my Outbox (using my private key)
        const outboxPath = this.context.storage.getPath(`dms/outbox/${date}.db`, 'private');
        const localMessage = { ...outgoing, localImage: localImage || outgoing.localImage };
        await this.dailyDb.withDatabase(outboxPath, (outboxDb: any) => {
            outboxDb.run('INSERT OR REPLACE INTO messages (id, content, timestamp, senderId, recipientId, image, isEdited, isDeleted, status, expiresAt, localImage, imageEphemeralPk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [localMessage.id, localMessage.content, localMessage.timestamp, localMessage.senderId, localMessage.recipientId, localMessage.image || null, localMessage.isEdited ? 1 : 0, localMessage.isDeleted ? 1 : 0, localMessage.status || 'sent', localMessage.expiresAt ?? null, localMessage.localImage || null, localMessage.imageEncryption?.ephemeralPublicKey || null]);
        }, { save: true, emitUpdate: true, applySchema: true });

        // 2. Send to Recipient's Public DM box (End-to-End Encrypted)
        const publicDmPath = this.context.storage.getPath(`dms/${recipientId}/${date}.db`, 'public');
        await this.dailyDb.withDatabase(publicDmPath, async (publicDb: any) => {
            publicDb.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, encrypted_data BLOB, ephemeral_pk TEXT);`);
            try {
                publicDb.exec(`ALTER TABLE messages ADD COLUMN ephemeral_pk TEXT;`);
            } catch (e: any) {
                Logger.debug('Messaging', 'Column ephemeral_pk already exists or alter table ignored');
            }

            // Do not serialize the sender-only local plaintext path into the wire payload.
            const { localImage: _localOnly, ...wireMessage } = outgoing;
            const encrypted = await this.context.encrypt(new TextEncoder().encode(JSON.stringify(wireMessage)), sharedSecret);
            
            publicDb.run('INSERT OR REPLACE INTO messages (id, encrypted_data, ephemeral_pk) VALUES (?, ?, ?)', [message.id, encrypted, ephemeralPublicKey]);
        }, { save: true, applySchema: false });

        this.context.emit(`${this.MODULE_NAME}:update`, { path: outboxPath });
    }

    /** Loads a DM attachment and decrypts it on the recipient device. Legacy attachments remain readable. */
    async getMessageImage(message: Message): Promise<Uint8Array | null> {
        if (message.localImage) return this.context.getBlob(message.localImage);
        const path = message.image;
        if (!path) return null;
        const data = await this.context.getBlob(path, message.senderId);
        if (!data) return null;
        if (!message.imageEncryption) {
            if ((this.options.minProtocolVersion ?? 'v1') === 'v3') {
                throw new AuthError('Unencrypted or legacy DM attachment rejected under V3 policy');
            }
            return data;
        }
        if (message.imageEncryption.version !== 1 || !message.imageEncryption.ephemeralPublicKey) {
            throw new AuthError('Unsupported encrypted DM attachment format');
        }
        const key = this.context.deriveRecipientSharedSecret(message.imageEncryption.ephemeralPublicKey);
        return this.context.decrypt(data, key);
    }

    async editMessage(recipientId: string, messageId: string, date: string, newContent: string) {
        const timestamp = Date.now();
        const senderId = this.context.userId;
        
        const outboxPath = this.context.storage.getPath(`dms/outbox/${date}.db`, 'private');
        let imagePath = null;
        let localImagePath = null;
        let imageEphemeralPk: string | null = null;
        if (await this.dailyDb.exists(outboxPath)) {
            await this.dailyDb.withDatabase(outboxPath, (outboxDb: any) => {
                const res = outboxDb.exec('SELECT image, localImage, imageEphemeralPk FROM messages WHERE id = ?', [messageId]);
                if (res && res.length > 0 && res[0].values.length > 0) {
                    imagePath = res[0].values[0][0];
                    localImagePath = res[0].values[0][1];
                    imageEphemeralPk = res[0].values[0][2];
                }
            }, { applySchema: true });
        }

        const message: Message = { 
            id: messageId, 
            content: newContent, 
            timestamp, 
            senderId, 
            recipientId, 
            image: imagePath || undefined,
            localImage: localImagePath || undefined,
            imageEncryption: imageEphemeralPk ? { version: 1, ephemeralPublicKey: imageEphemeralPk } : undefined,
            isEdited: true,
            isDeleted: false,
            status: 'sent'
        };

        await this._saveAndSendDM(recipientId, message, date);
    }

    async deleteMessage(recipientId: string, messageId: string, date: string) {
        const timestamp = Date.now();
        const senderId = this.context.userId;

        const message: Message = { 
            id: messageId, 
            content: "", 
            timestamp, 
            senderId, 
            recipientId, 
            image: undefined,
            isEdited: false,
            isDeleted: true,
            status: 'sent'
        };

        await this._saveAndSendDM(recipientId, message, date);
        await this.compactDatabase(date, false).catch(() => {});
    }

    async markAsRead(senderId: string, messageId: string, date: string) {
        const path = this.context.storage.getPath(`receipts/${senderId}/${date}.db`, 'public');
        await this.dailyDb.withDatabase(path, (db: any) => {
            db.exec(`CREATE TABLE IF NOT EXISTS receipts (messageId TEXT PRIMARY KEY, status TEXT, timestamp INTEGER);`);
            db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [messageId, 'read', Date.now()]);
        }, { save: true, emitUpdate: true, applySchema: false, immediate: true });
    }

    async markBatchAsRead(senderId: string, messages: {id: string, date: string}[]) {
        const dates = [...new Set(messages.map(m => m.date))];
        for (const date of dates) {
            const path = this.context.storage.getPath(`receipts/${senderId}/${date}.db`, 'public');
            const msgsForDate = messages.filter(m => m.date === date);
            await this.dailyDb.withDatabase(path, (db: any) => {
                db.exec(`CREATE TABLE IF NOT EXISTS receipts (messageId TEXT PRIMARY KEY, status TEXT, timestamp INTEGER);`);
                for (const m of msgsForDate) {
                    db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [m.id, 'read', Date.now()]);
                }
            }, { save: true, emitUpdate: true, applySchema: false, immediate: true });
        }
    }

    async markAsDelivered(senderId: string, messageId: string, date: string) {
        const path = this.context.storage.getPath(`receipts/${senderId}/${date}.db`, 'public');
        await this.dailyDb.withDatabase(path, (db: any) => {
            db.exec(`CREATE TABLE IF NOT EXISTS receipts (messageId TEXT PRIMARY KEY, status TEXT, timestamp INTEGER);`);
            const existing = db.exec('SELECT status FROM receipts WHERE messageId = ?', [messageId]);
            if (existing && existing.length > 0 && existing[0].values.length > 0 && existing[0].values[0][0] === 'read') {
                return false;
            }
            db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [messageId, 'delivered', Date.now()]);
            return true;
        }, { save: (changed) => !!changed, emitUpdate: true, applySchema: false, immediate: true });
    }

    async markBatchAsDelivered(senderId: string, messages: {id: string, date: string}[]) {
        const dates = [...new Set(messages.map(m => m.date))];
        for (const date of dates) {
            const path = this.context.storage.getPath(`receipts/${senderId}/${date}.db`, 'public');
            const msgsForDate = messages.filter(m => m.date === date);
            await this.dailyDb.withDatabase(path, (db: any) => {
                db.exec(`CREATE TABLE IF NOT EXISTS receipts (messageId TEXT PRIMARY KEY, status TEXT, timestamp INTEGER);`);
                let changed = false;
                for (const m of msgsForDate) {
                    const existing = db.exec('SELECT status FROM receipts WHERE messageId = ?', [m.id]);
                    if (!(existing && existing.length > 0 && existing[0].values.length > 0 && existing[0].values[0][0] === 'read')) {
                        db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [m.id, 'delivered', Date.now()]);
                        changed = true;
                    }
                }
                return changed;
            }, { save: (changed) => !!changed, emitUpdate: true, applySchema: false, immediate: true });
        }
    }

    /**
     * Gets the delivery or read receipt status of an outgoing message from the outbox.
     */
    async getMessageReceipt(messageId: string, date: string): Promise<'sent' | 'delivered' | 'read' | null> {
        const outboxPath = this.context.storage.getPath(`dms/outbox/${date}.db`, 'private');
        if (!(await this.dailyDb.exists(outboxPath))) return null;
        return await this.dailyDb.withDatabase(outboxPath, (db: any) => {
            const res = db.exec('SELECT status FROM messages WHERE id = ?', [messageId]);
            if (res && res.length > 0 && res[0].values.length > 0) {
                return (res[0].values[0][0] as any) || 'sent';
            }
            return null;
        }, { applySchema: true });
    }

    async getInboxMessages(days: number = 5): Promise<Message[]> {
        const messages: Message[] = [];
        const following = await this.context.getFollowing();
        const myId = this.context.userId;
        const sqliteInstance = await DailyDatabase.getSqliteInstance();

        const dates: string[] = [];
        // Include UTC tomorrow (i = -1) to tolerate clock skew and midnight boundary transitions,
        // followed by the previous `days` UTC days.
        for (let i = -1; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }

        // 1. Pull Receipts and update local outbox
        for (const user of following) {
            for (const date of dates) {
                const receiptPath = this.context.storage.getPath(`${user.userId}/receipts/${myId}/${date}.db`, 'followed');
                const receiptData = await this.context.storage.raw.getFile(receiptPath);
                if (receiptData) {
                    const rdb = new sqliteInstance.Database(receiptData);
                    try {
                        const res = rdb.exec('SELECT messageId, status FROM receipts');
                        if (res && res.length > 0) {
                            const outboxPath = this.context.storage.getPath(`dms/outbox/${date}.db`, 'private');
                            await this.dailyDb.withDatabase(outboxPath, (outboxDb: any) => {
                                for (const row of res[0].values) {
                                    const [mid, status] = row;
                                    outboxDb.run(`
                                        UPDATE messages SET status = ? 
                                        WHERE id = ? AND (
                                            (status = 'sent' AND ? IN ('delivered', 'read')) OR
                                            (status = 'delivered' AND ? = 'read')
                                        )
                                    `, [status, mid, status, status]);
                                }
                            }, { save: true, emitUpdate: true, applySchema: true });
                        }
                    } catch (e: any) {
                        Logger.warn('Messaging', `Failed to apply receipt update from ${user.userId}: ${e.message}`);
                    }
                    rdb.close();
                }
            }
        }

        // 2. Fetch Incoming Messages
        for (const user of following) {
            // V2: HKDF-derived shared secret (default)
            const sharedSecretV2 = this.context.deriveSharedSecret(user.publicKey);
            // V1: Raw shared secret — for backward compat with messages sent before HKDF was introduced
            const sharedSecretV1 = this.context.deriveSharedSecret(user.publicKey, 'SovereignS3nc-DM-v1-raw');
            for (const date of dates) {
                const localPath = this.context.storage.getPath(`${user.userId}/dms/${myId}/${date}.db`, 'followed');
                const data = await this.context.storage.raw.getFile(localPath);
                if (data) {
                    const db = new sqliteInstance.Database(data);
                    try {
                        let hasEphemeralCol = false;
                        try {
                            const tableInfo = db.exec("PRAGMA table_info(messages)");
                            if (tableInfo && tableInfo.length > 0) {
                                hasEphemeralCol = tableInfo[0].values.some((col: any) => col[1] === 'ephemeral_pk');
                            }
                        } catch (e: any) {
                            Logger.debug('Messaging', `PRAGMA table_info check failed: ${e.message}`);
                        }

                        const query = hasEphemeralCol 
                            ? 'SELECT encrypted_data, ephemeral_pk FROM messages'
                            : 'SELECT encrypted_data FROM messages';
                        const res = db.exec(query);
                        if (res && res.length > 0) {
                            const newMsgsForUser: Message[] = [];
                            for (const row of res[0].values) {
                                try {
                                    const encryptedData = row[0] as Uint8Array;
                                    const ephemeralPk = hasEphemeralCol ? (row[1] as string | null) : null;
                                    let decrypted: Uint8Array | null = null;

                                    const minVersion = this.options.minProtocolVersion ?? 'v1';

                                    // V3: Try forward-secret ephemeral key if present
                                    if (ephemeralPk) {
                                        try {
                                            const sharedSecretV3 = this.context.deriveRecipientSharedSecret(ephemeralPk);
                                            decrypted = await this.context.decrypt(encryptedData, sharedSecretV3);
                                        } catch (e: any) {
                                            Logger.debug('Messaging', `V3 ephemeral decrypt failed: ${e.message}`);
                                        }
                                    } else if (minVersion === 'v3') {
                                        Logger.warn('Messaging', `Protocol downgrade rejected: message missing required V3 ephemeral key from user ${user.userId}`);
                                    }

                                    // V2: Fall back to static HKDF shared secret (only allowed if minVersion is not 'v3')
                                    if (!decrypted && minVersion !== 'v3') {
                                        try {
                                            decrypted = await this.context.decrypt(encryptedData, sharedSecretV2);
                                        } catch (e: any) {
                                            Logger.debug('Messaging', `V2 static HKDF decrypt failed: ${e.message}`);
                                        }
                                    }

                                    // V1: Fall back to raw legacy shared secret (pre-HKDF) (only allowed if minVersion is 'v1')
                                    if (!decrypted && minVersion === 'v1') {
                                        try {
                                            decrypted = await this.context.decrypt(encryptedData, sharedSecretV1);
                                        } catch (e: any) {
                                            Logger.debug('Messaging', `V1 raw legacy decrypt failed: ${e.message}`);
                                        }
                                    }

                                    if (decrypted) {
                                        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Message;
                                        if (typeof (parsed as any).isEdited === 'number') parsed.isEdited = !!(parsed as any).isEdited;
                                        if (typeof (parsed as any).isDeleted === 'number') parsed.isDeleted = !!(parsed as any).isDeleted;
                                        messages.push(parsed);
                                        newMsgsForUser.push(parsed);
                                    }
                                } catch (e: any) {
                                    Logger.warn('Messaging', `Failed to decrypt/parse message: ${e.message}`);
                                }
                            }
                            if (newMsgsForUser.length > 0) {
                                await this.markBatchAsDelivered(user.userId, newMsgsForUser.map(m => ({
                                    id: m.id,
                                    date
                                })));
                            }
                        }
                    } catch (e: any) {
                        Logger.warn('Messaging', `Failed to process incoming DM SQLite db from ${user.userId}: ${e.message}`);
                    }
                    db.close();
                }
            }
        }

        // 3. Fetch My Outbox
        for (const date of dates) {
            const outboxPath = this.context.storage.getPath(`dms/outbox/${date}.db`, 'private');
            if (await this.dailyDb.exists(outboxPath)) {
                await this.dailyDb.withDatabase(outboxPath, (db: any) => {
                    const res = db.exec('SELECT * FROM messages');
                    if (res && res.length > 0 && res[0].values && res[0].columns) {
                        const columns = res[0].columns;
                        const myMsgs = res[0].values.map((row: any) => {
                            const msg: any = {};
                            columns.forEach((col: string, i: number) => {
                                let val = row[i];
                                if ((col === 'isEdited' || col === 'isDeleted') && typeof val === 'number') {
                                    val = !!val;
                                }
                                msg[col] = val;
                            });
                            if (msg.imageEphemeralPk) {
                                msg.imageEncryption = { version: 1, ephemeralPublicKey: msg.imageEphemeralPk };
                                delete msg.imageEphemeralPk;
                            }
                            return msg as Message;
                        });
                        messages.push(...myMsgs);
                    }
                }, { applySchema: true });
            }
        }

        const now = Date.now();
        const msgMap = new Map<string, Message>();
        for (const m of messages) {
            if (m.expiresAt && m.expiresAt <= now) {
                continue;
            }
            const existing = msgMap.get(m.id);
            if (!existing || m.timestamp > existing.timestamp) {
                msgMap.set(m.id, m);
            }
        }

        const finalMsgs = Array.from(msgMap.values());
        finalMsgs.sort((a, b) => b.timestamp - a.timestamp);
        return finalMsgs;
    }

    /**
     * Purges expired messages from outbox database partitions.
     */
    async cleanupExpired(dates?: string[]): Promise<number> {
        const targetDates = dates && dates.length > 0 ? dates : [new Date().toISOString().split('T')[0]];
        let deleted = 0;
        const now = Date.now();

        for (const date of targetDates) {
            const outboxPath = this.context.storage.getPath(`dms/outbox/${date}.db`, 'private');
            if (await this.dailyDb.exists(outboxPath)) {
                const count = await this.dailyDb.withDatabase(outboxPath, (db: any) => {
                    const countRes = db.exec('SELECT COUNT(*) FROM messages WHERE expiresAt IS NOT NULL AND expiresAt <= ?', [now]);
                    let c = 0;
                    if (countRes && countRes.length > 0 && countRes[0].values[0]) {
                        c = Number(countRes[0].values[0][0]);
                        if (c > 0) {
                            db.run('DELETE FROM messages WHERE expiresAt IS NOT NULL AND expiresAt <= ?', [now]);
                            db.run('VACUUM');
                        }
                    }
                    return c;
                }, { save: true, emitUpdate: true, applySchema: true, immediate: true });
                deleted += count;
            }
        }
        return deleted;
    }

    /**
     * Compacts outbox SQLite databases by permanently purging deleted/tombstoned/expired records
     * and running SQLite VACUUM to reclaim disk and IndexedDB quota.
     * Compaction runs if tombstone ratio >= 50% or if force is true.
     */
    async compactDatabase(date?: string, force: boolean = false): Promise<{
        compacted: boolean;
        originalSize: number;
        newSize: number;
        freedBytes: number;
        tombstoneRatio: number;
    }> {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const outboxPath = this.context.storage.getPath(`dms/outbox/${targetDate}.db`, 'private');
        if (!(await this.dailyDb.exists(outboxPath))) {
            return { compacted: false, originalSize: 0, newSize: 0, freedBytes: 0, tombstoneRatio: 0 };
        }
        const data = await this.context.storage.raw.getFile(outboxPath);
        const originalSize = data ? data.byteLength : 0;
        const now = Date.now();
        let compacted = false;
        let newSize = originalSize;
        let tombstoneRatio = 0;

        await this.dailyDb.withDatabase(outboxPath, (db: any) => {
            const totalRes = db.exec('SELECT COUNT(*) FROM messages');
            const total = (totalRes && totalRes.length > 0 && totalRes[0].values[0]) ? Number(totalRes[0].values[0][0]) : 0;

            const tombstoneRes = db.exec('SELECT COUNT(*) FROM messages WHERE isDeleted = 1 OR (expiresAt IS NOT NULL AND expiresAt <= ?)', [now]);
            const tombstones = (tombstoneRes && tombstoneRes.length > 0 && tombstoneRes[0].values[0]) ? Number(tombstoneRes[0].values[0][0]) : 0;

            tombstoneRatio = total > 0 ? tombstones / total : 0;

            if (force || (tombstones >= 50 && tombstoneRatio >= 0.5)) {
                db.run('DELETE FROM messages WHERE isDeleted = 1 OR (expiresAt IS NOT NULL AND expiresAt <= ?)', [now]);
                db.run('VACUUM');
                const compactedBinary = db.export();
                newSize = compactedBinary.byteLength;
                compacted = true;
            }
        }, { save: true, emitUpdate: true, applySchema: true, immediate: true });

        return {
            compacted,
            originalSize,
            newSize,
            freedBytes: originalSize - newSize,
            tombstoneRatio
        };
    }
}
