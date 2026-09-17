
import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';
import { env } from '../utils/Environment';
import { ModuleError, AuthError } from '../utils/Errors';
import { DEFAULTS } from '../utils/Constants';

export interface Message {
    id: string;
    content: string;
    timestamp: number;
    senderId: string;
    recipientId: string;
    image?: string;
    isEdited?: boolean;
    isDeleted?: boolean;
    status?: 'sent' | 'delivered' | 'read';
    /** Optional expiration timestamp (Unix ms). Messages past this time are purged by cleanupExpired(). */
    expiresAt?: number;
}

export class MessagingModule {
    private readonly MODULE_NAME = 'messaging';

    constructor(private db: SovereignS3nc) {
        this.db.registerModule({
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
                        isDeleted INTEGER DEFAULT 0,
                        status TEXT DEFAULT 'sent',
                        expiresAt INTEGER DEFAULT NULL
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
                }
            ]
        });
    }

    private async getMessageDb(date: string, type: 'inbox' | 'outbox'): Promise<any> {
        const path = this.db.getModulePath(this.MODULE_NAME, `dms/${type}/${date}.db`, 'private');
        const data = await this.db.getStorage().getFile(path);
        
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('messaging', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});
        
        let db: any;
        try {
            db = new sqliteInstance.Database(data || undefined);
        } catch (e: any) {
            if (e.message?.includes('malformed') || e.message?.includes('not a database')) {
                Logger.error('Messaging', `Database corruption detected at ${path}. Deleting.`);
                await this.db.getStorage().deleteFile(path);
                db = new sqliteInstance.Database();
            } else {
                throw e;
            }
        }

        this.db.applyModuleSchema(db, this.MODULE_NAME);
        return db;
    }

    private async getReceiptsDb(userId: string, date: string, type: 'public' | 'followed'): Promise<any> {
        const path = this.db.getModulePath(this.MODULE_NAME, `receipts/${userId}/${date}.db`, type);
        const data = await this.db.getStorage().getFile(path);
        
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('messaging', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});
        
        let db: any;
        try {
            db = new sqliteInstance.Database(data || undefined);
        } catch (e: any) {
            db = new sqliteInstance.Database();
        }

        db.exec(`CREATE TABLE IF NOT EXISTS receipts (messageId TEXT PRIMARY KEY, status TEXT, timestamp INTEGER);`);
        return db;
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
        const senderId = this.db.getConfig().paths.userId;

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, true);
        }

        const message: Message = { id, content, timestamp, senderId, recipientId, image: imagePath || undefined, isEdited: false, isDeleted: false, status: 'sent', expiresAt };
        await this._saveAndSendDM(recipientId, message, date);
    }

    private async _saveAndSendDM(recipientId: string, message: Message, date: string) {
        // 1. Save to my Outbox (using my private key)
        const outboxDb = await this.getMessageDb(date, 'outbox');
        outboxDb.run('INSERT OR REPLACE INTO messages (id, content, timestamp, senderId, recipientId, image, isEdited, isDeleted, status, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
            [message.id, message.content, message.timestamp, message.senderId, message.recipientId, message.image || null, message.isEdited ? 1 : 0, message.isDeleted ? 1 : 0, message.status || 'sent', message.expiresAt ?? null]);

        const outboxPath = this.db.getModulePath(this.MODULE_NAME, `dms/outbox/${date}.db`, 'private');
        await this.db.getStorage().saveFile(outboxPath, outboxDb.export());
        outboxDb.close();

        // 2. Send to Recipient's Public DM box (End-to-End Encrypted)
        const publicDmPath = this.db.getModulePath(this.MODULE_NAME, `dms/${recipientId}/${date}.db`, 'public');
        const publicDmData = await this.db.getStorage().getFile(publicDmPath);
        
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('messaging', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});
        
        let publicDb: any;
        try {
            publicDb = new sqliteInstance.Database(publicDmData || undefined);
        } catch (e: any) {
            publicDb = new sqliteInstance.Database();
        }
        
        publicDb.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, encrypted_data BLOB);`);

        const registry = await this.db.getPublicRegistry();
        let recipient = registry.find(u => u.userId === recipientId);
        
        if (!recipient) {
            const following = await this.db.getFollowing();
            const f = following.find(u => u.userId === recipientId);
            if (f && f.publicKey) {
                recipient = { userId: f.userId, publicKey: f.publicKey };
            }
        }

        if (!recipient || !recipient.publicKey) throw new AuthError('Recipient public key not found');

        const sharedSecret = this.db.deriveSharedSecret(recipient.publicKey);
        const encrypted = await this.db.encrypt(new TextEncoder().encode(JSON.stringify(message)), sharedSecret);
        
        publicDb.run('INSERT OR REPLACE INTO messages (id, encrypted_data) VALUES (?, ?)', [message.id, encrypted]);

        await this.db.getStorage().saveFile(publicDmPath, publicDb.export());
        publicDb.close();

        this.db.emit(`${this.MODULE_NAME}:update`, { path: outboxPath });
    }

    async editMessage(recipientId: string, messageId: string, date: string, newContent: string) {
        const timestamp = Date.now();
        const senderId = this.db.getConfig().paths.userId;
        
        const outboxDb = await this.getMessageDb(date, 'outbox');
        const res = outboxDb.exec('SELECT image FROM messages WHERE id = ?', [messageId]);
        let imagePath = null;
        if (res && res.length > 0 && res[0].values.length > 0) {
            imagePath = res[0].values[0][0];
        }
        outboxDb.close();

        const message: Message = { 
            id: messageId, 
            content: newContent, 
            timestamp, 
            senderId, 
            recipientId, 
            image: imagePath || undefined,
            isEdited: true,
            isDeleted: false,
            status: 'sent'
        };

        await this._saveAndSendDM(recipientId, message, date);
    }

    async deleteMessage(recipientId: string, messageId: string, date: string) {
        const timestamp = Date.now();
        const senderId = this.db.getConfig().paths.userId;

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
    }

    async markAsRead(senderId: string, messageId: string, date: string) {
        const db = await this.getReceiptsDb(senderId, date, 'public');
        db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [messageId, 'read', Date.now()]);
        
        const path = this.db.getModulePath(this.MODULE_NAME, `receipts/${senderId}/${date}.db`, 'public');
        await this.db.getStorage().saveFile(path, db.export());
        db.close();
        
        this.db.emit(`${this.MODULE_NAME}:update`, { path });
    }

    async markBatchAsRead(senderId: string, messages: {id: string, date: string}[]) {
        const dates = [...new Set(messages.map(m => m.date))];
        for (const date of dates) {
            const db = await this.getReceiptsDb(senderId, date, 'public');
            const msgsForDate = messages.filter(m => m.date === date);
            for (const m of msgsForDate) {
                db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [m.id, 'read', Date.now()]);
            }
            const path = this.db.getModulePath(this.MODULE_NAME, `receipts/${senderId}/${date}.db`, 'public');
            await this.db.getStorage().saveFile(path, db.export());
            db.close();
            this.db.emit(`${this.MODULE_NAME}:update`, { path });
        }
    }

    async markAsDelivered(senderId: string, messageId: string, date: string) {
        const db = await this.getReceiptsDb(senderId, date, 'public');
        const existing = db.exec('SELECT status FROM receipts WHERE messageId = ?', [messageId]);
        if (existing && existing.length > 0 && existing[0].values.length > 0 && existing[0].values[0][0] === 'read') {
            db.close();
            return;
        }
        
        db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [messageId, 'delivered', Date.now()]);
        
        const path = this.db.getModulePath(this.MODULE_NAME, `receipts/${senderId}/${date}.db`, 'public');
        await this.db.getStorage().saveFile(path, db.export());
        db.close();
        
        this.db.emit(`${this.MODULE_NAME}:update`, { path });
    }

    async markBatchAsDelivered(senderId: string, messages: {id: string, date: string}[]) {
        const dates = [...new Set(messages.map(m => m.date))];
        for (const date of dates) {
            const db = await this.getReceiptsDb(senderId, date, 'public');
            const msgsForDate = messages.filter(m => m.date === date);
            let changed = false;
            for (const m of msgsForDate) {
                const existing = db.exec('SELECT status FROM receipts WHERE messageId = ?', [m.id]);
                if (!(existing && existing.length > 0 && existing[0].values.length > 0 && existing[0].values[0][0] === 'read')) {
                    db.run('INSERT OR REPLACE INTO receipts (messageId, status, timestamp) VALUES (?, ?, ?)', [m.id, 'delivered', Date.now()]);
                    changed = true;
                }
            }
            if (changed) {
                const path = this.db.getModulePath(this.MODULE_NAME, `receipts/${senderId}/${date}.db`, 'public');
                await this.db.getStorage().saveFile(path, db.export());
                this.db.emit(`${this.MODULE_NAME}:update`, { path });
            }
            db.close();
        }
    }

    async getInboxMessages(days: number = 5): Promise<Message[]> {
        const messages: Message[] = [];
        const following = await this.db.getFollowing();
        const myId = this.db.getConfig().paths.userId;
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('messaging', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});

        const dates: string[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }

        // 1. Pull Receipts and update local outbox
        for (const user of following) {
            for (const date of dates) {
                const receiptPath = this.db.getModulePath(this.MODULE_NAME, `${user.userId}/receipts/${myId}/${date}.db`, 'followed');
                const receiptData = await this.db.getStorage().getFile(receiptPath);
                if (receiptData) {
                    const rdb = new sqliteInstance.Database(receiptData);
                    try {
                        const res = rdb.exec('SELECT messageId, status FROM receipts');
                        if (res && res.length > 0) {
                            const outboxDb = await this.getMessageDb(date, 'outbox');
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
                            const outboxPath = this.db.getModulePath(this.MODULE_NAME, `dms/outbox/${date}.db`, 'private');
                            await this.db.getStorage().saveFile(outboxPath, outboxDb.export());
                            outboxDb.close();
                        }
                    } catch (e) {}
                    rdb.close();
                }
            }
        }

        // 2. Fetch Incoming Messages
        for (const user of following) {
            // V2: HKDF-derived shared secret (default)
            const sharedSecretV2 = this.db.deriveSharedSecret(user.publicKey);
            // V1: Raw shared secret — for backward compat with messages sent before HKDF was introduced
            const sharedSecretV1 = this.db.deriveSharedSecret(user.publicKey, 'SovereignS3nc-DM-v1-raw');
            for (const date of dates) {
                const localPath = this.db.getModulePath(this.MODULE_NAME, `${user.userId}/dms/${myId}/${date}.db`, 'followed');
                const data = await this.db.getStorage().getFile(localPath);
                if (data) {
                    const db = new sqliteInstance.Database(data);
                    try {
                        const res = db.exec('SELECT encrypted_data FROM messages');
                        if (res && res.length > 0) {
                            const newMsgsForUser: Message[] = [];
                            for (const row of res[0].values) {
                                try {
                                    // Try V2 (HKDF) first; fall back to V1 (raw) for legacy messages
                                    let decrypted: Uint8Array;
                                    try {
                                        decrypted = await this.db.decrypt(row[0] as Uint8Array, sharedSecretV2);
                                    } catch (e) {
                                        // V2 failed — attempt V1 for backward compat with pre-HKDF messages
                                        decrypted = await this.db.decrypt(row[0] as Uint8Array, sharedSecretV1);
                                    }
                                    if (decrypted) {
                                        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Message;
                                        if (typeof (parsed as any).isEdited === 'number') parsed.isEdited = !!(parsed as any).isEdited;
                                        if (typeof (parsed as any).isDeleted === 'number') parsed.isDeleted = !!(parsed as any).isDeleted;
                                        messages.push(parsed);
                                        newMsgsForUser.push(parsed);
                                    }
                                } catch (e) {}
                            }
                            if (newMsgsForUser.length > 0) {
                                await this.markBatchAsDelivered(user.userId, newMsgsForUser.map(m => ({
                                    id: m.id,
                                    date
                                })));
                            }
                        }
                    } catch (e) {}
                    db.close();
                }
            }
        }

        // 3. Fetch My Outbox
        for (const date of dates) {
            const outboxPath = this.db.getModulePath(this.MODULE_NAME, `dms/outbox/${date}.db`, 'private');
            const data = await this.db.getStorage().getFile(outboxPath);
            if (data) {
                const db = new sqliteInstance.Database(data);
                try {
                    const res = db.exec('SELECT * FROM messages');
                    if (res && res.length > 0) {
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
                            return msg as Message;
                        });
                        messages.push(...myMsgs);
                    }
                } catch (e) {}
                db.close();
            }
        }

        const msgMap = new Map<string, Message>();
        for (const m of messages) {
            const existing = msgMap.get(m.id);
            if (!existing || m.timestamp > existing.timestamp) {
                msgMap.set(m.id, m);
            }
        }

        const finalMsgs = Array.from(msgMap.values());
        finalMsgs.sort((a, b) => b.timestamp - a.timestamp);
        return finalMsgs;
    }
}
