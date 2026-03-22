
import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';

export interface Message {
    id: string;
    content: string;
    timestamp: number;
    senderId: string;
    recipientId: string;
    image?: string;
    isEdited?: boolean;
    isDeleted?: boolean;
}

export class MessagingModule {
    private readonly MODULE_NAME = 'messaging';

    constructor(private db: SovereignS3nc) {
        // Registering a minimal definition if we want to use declarative schema, 
        // but messaging currently uses a mix of transport-db and outbox-db.
        // For now, we'll keep the social module's table names for compatibility.
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
                        isDeleted INTEGER DEFAULT 0
                    `
                }
            ]
        });
    }

    private async getMessageDb(date: string, type: 'inbox' | 'outbox'): Promise<any> {
        // We use a namespaced path for the new module
        const path = this.db.getModulePath(this.MODULE_NAME, `dms/${type}/${date}.db`, 'private');
        const data = await this.db.getStorage().getFile(path);
        
        // @ts-ignore - access global initSqlJs
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const db = new sqliteInstance.Database(data || undefined);

        // Use Core Schema Management
        this.db.applyModuleSchema(db, this.MODULE_NAME);

        return db;
    }

    async sendDirectMessage(recipientId: string, content: string, image?: Uint8Array) {
        const date = new Date().toISOString().split('T')[0];
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const senderId = this.db.getConfig().paths.userId;

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, true); // Use public blob for DM transport
        }

        const message: Message = { id, content, timestamp, senderId, recipientId, image: imagePath || undefined, isEdited: false, isDeleted: false };
        await this._saveAndSendDM(recipientId, message, date);
    }

    private async _saveAndSendDM(recipientId: string, message: Message, date: string) {
        // 1. Save to my Outbox (using my private key)
        const outboxDb = await this.getMessageDb(date, 'outbox');
        outboxDb.run('INSERT OR REPLACE INTO messages (id, content, timestamp, senderId, recipientId, image, isEdited, isDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
            [message.id, message.content, message.timestamp, message.senderId, message.recipientId, message.image || null, message.isEdited ? 1 : 0, message.isDeleted ? 1 : 0]);

        const outboxPath = this.db.getModulePath(this.MODULE_NAME, `dms/outbox/${date}.db`, 'private');
        await this.db.getStorage().saveFile(outboxPath, outboxDb.export());
        outboxDb.close();

        // 2. Send to Recipient's Public DM box (End-to-End Encrypted)
        // Note: For compatibility, we might want to use the 'social' module's pathing for the transport layer 
        // if we want to communicate with older versions, or just move to 'messaging'.
        // The TODO says "Create src/modules/Messaging.ts for E2EE DM workflows (using core primitives)."
        const publicDmPath = this.db.getModulePath(this.MODULE_NAME, `dms/${recipientId}/${date}.db`, 'public');
        const publicDmData = await this.db.getStorage().getFile(publicDmPath);
        
        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const publicDb = new sqliteInstance.Database(publicDmData || undefined);
        
        // Manual Schema for DM transport (not part of declarative module schema as it is a transport db)
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

        if (!recipient || !recipient.publicKey) throw new Error('Recipient public key not found');

        // E2EE: Derive shared secret from my Private Key + their Public Key
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
            image: imagePath,
            isEdited: true,
            isDeleted: false 
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
            isDeleted: true 
        };

        await this._saveAndSendDM(recipientId, message, date);
    }

    async getInboxMessages(days: number = 5): Promise<Message[]> {
        const messages: Message[] = [];
        const following = await this.db.getFollowing();
        
        const dates: string[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }

        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        const myId = this.db.getConfig().paths.userId;

        for (const user of following) {
            const sharedSecret = this.db.deriveSharedSecret(user.publicKey);

            for (const date of dates) {
                // Check both new and old module paths for compatibility
                const pathsToCheck = [
                    this.db.getModulePath(this.MODULE_NAME, `${user.userId}/dms/${myId}/${date}.db`, 'followed'),
                    this.db.getModulePath('social', `${user.userId}/dms/${myId}/${date}.db`, 'followed')
                ];

                for (const localPath of pathsToCheck) {
                    const data = await this.db.getStorage().getFile(localPath);
                    if (data) {
                        const db = new sqliteInstance.Database(data);
                        try {
                            const res = db.exec('SELECT encrypted_data FROM messages');
                            if (res && res.length > 0) {
                                for (const row of res[0].values) {
                                    try {
                                        const decrypted = await this.db.decrypt(row[0] as Uint8Array, sharedSecret);
                                        if (decrypted) {
                                            const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Message;
                                            if (typeof (parsed as any).isEdited === 'number') parsed.isEdited = !!(parsed as any).isEdited;
                                            if (typeof (parsed as any).isDeleted === 'number') parsed.isDeleted = !!(parsed as any).isDeleted;
                                            messages.push(parsed);
                                        }
                                    } catch (e) {}
                                }
                            }
                        } catch (e) {}
                        db.close();
                    }
                }
            }
        }

        // Also check my own outbox (both new and old)
        for (const date of dates) {
            const pathsToCheck = [
                this.db.getModulePath(this.MODULE_NAME, `dms/outbox/${date}.db`, 'private'),
                this.db.getModulePath('social', `dms/outbox/${date}.db`, 'private')
            ];

            for (const outboxPath of pathsToCheck) {
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
        }

        // Deduplicate
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
