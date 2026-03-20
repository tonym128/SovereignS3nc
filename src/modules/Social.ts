import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';

export interface Post {
    id: string;
    content: string;
    timestamp: number;
    userId: string;
    image?: string;
    parentId?: string;
    parentUserId?: string;
    likesCount?: number;
    likedByMe?: boolean;
    isEdited?: boolean;
    isDeleted?: boolean;
}

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

export class SocialManager {
    private sqliteInstance: any = null;
    private readonly MODULE_NAME = 'social';

    constructor(private db: SovereignS3nc, private localPath: string, private sqliteProvider?: any) {
        this.db.registerModule(this.MODULE_NAME);
    }

    private async getDb(date: string, type: 'private' | 'public' | 'followed'): Promise<any> {
        const dbPath = type === 'followed' 
            ? this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed')
            : this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
            
        const data = await this.db.getStorage().getFile(dbPath);
        
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!initSqlJs) {
            throw new Error('sql.js not found. Ensure it is loaded in the environment.');
        }

        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        }
        const db = new this.sqliteInstance.Database(data || undefined);

        // Initialize Schema
        db.exec(`
            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                userId TEXT,
                image TEXT,
                parentId TEXT,
                parentUserId TEXT,
                isEdited INTEGER DEFAULT 0,
                isDeleted INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS likes (
                postId TEXT,
                userId TEXT,
                timestamp INTEGER,
                PRIMARY KEY (postId, userId)
            );
        `);

        // Migration: Ensure columns exist
        try { db.exec('ALTER TABLE posts ADD COLUMN image TEXT;'); } catch (e) {}
        try {
            db.exec('ALTER TABLE posts ADD COLUMN parentId TEXT;');
            db.exec('ALTER TABLE posts ADD COLUMN parentUserId TEXT;');
        } catch (e) {}
        try { db.exec('ALTER TABLE posts ADD COLUMN isEdited INTEGER DEFAULT 0;'); } catch (e) {}
        try { db.exec('ALTER TABLE posts ADD COLUMN isDeleted INTEGER DEFAULT 0;'); } catch (e) {}

        return db;
    }

    async like(postId: string, isPublic: boolean = true) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        const userId = this.db.getConfig().paths.userId;
        const timestamp = Date.now();

        db.run('INSERT OR REPLACE INTO likes (postId, userId, timestamp) VALUES (?, ?, ?)', [postId, userId, timestamp]);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();
    }

    async post(content: string, isPublic: boolean = true, image?: Uint8Array, parentId?: string, parentUserId?: string) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const userId = this.db.getConfig().paths.userId;

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, isPublic);
        }

        const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, parentId, parentUserId, isEdited, isDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)';
        const params = [id, content, timestamp, userId, imagePath, parentId || null, parentUserId || null];

        db.run(sql, params);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();
    }

    async editPost(postId: string, date: string, newContent: string, isPublic: boolean = true) {
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        db.run('UPDATE posts SET content = ?, isEdited = 1, timestamp = ? WHERE id = ?', [newContent, Date.now(), postId]);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();
    }

    async deletePost(postId: string, date: string, isPublic: boolean = true) {
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        // Remove content and image, but keep item
        db.run('UPDATE posts SET content = "", image = NULL, isDeleted = 1, timestamp = ? WHERE id = ?', [Date.now(), postId]);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();
    }

    async getMessageDb(date: string, type: 'inbox' | 'outbox'): Promise<any> {
        const path = this.db.getModulePath(this.MODULE_NAME, `dms/${type}/${date}.db`, 'private');
        const data = await this.db.getStorage().getFile(path);
        
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        }
        const db = new this.sqliteInstance.Database(data || undefined);

        db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                senderId TEXT,
                recipientId TEXT,
                image TEXT,
                isEdited INTEGER DEFAULT 0,
                isDeleted INTEGER DEFAULT 0
            );
        `);
        
        // Migrations
        try { db.exec('ALTER TABLE messages ADD COLUMN isEdited INTEGER DEFAULT 0;'); } catch (e) {}
        try { db.exec('ALTER TABLE messages ADD COLUMN isDeleted INTEGER DEFAULT 0;'); } catch (e) {}

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
        const publicDmPath = this.db.getModulePath(this.MODULE_NAME, `dms/${recipientId}/${date}.db`, 'public');
        const publicDmData = await this.db.getStorage().getFile(publicDmPath);
        
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const publicDb = new this.sqliteInstance.Database(publicDmData || undefined);
        publicDb.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, encrypted_data BLOB);`);

        const registry = await this.db.getPublicRegistry();
        let recipient = registry.find(u => u.userId === recipientId);
        
        if (!recipient) {
            // Fallback to following list in case of fragmented P2P network
            const following = await this.db.getFollowing();
            const f = following.find(u => u.userId === recipientId);
            if (f && f.publicKey) {
                recipient = { userId: f.userId, publicKey: f.publicKey };
            }
        }

        if (!recipient || !recipient.publicKey) throw new Error('Recipient public key not found (Try syncing or re-adding friend)');

        // E2EE: Derive shared secret from my Private Key + their Public Key
        const sharedSecret = this.db.deriveSharedSecret(recipient.publicKey);
        const encrypted = await this.db.encrypt(new TextEncoder().encode(JSON.stringify(message)), sharedSecret);
        
        publicDb.run('INSERT OR REPLACE INTO messages (id, encrypted_data) VALUES (?, ?)', [message.id, encrypted]);

        await this.db.getStorage().saveFile(publicDmPath, publicDb.export());
        publicDb.close();
    }

    async editMessage(recipientId: string, messageId: string, date: string, newContent: string) {
        const timestamp = Date.now();
        const senderId = this.db.getConfig().paths.userId;
        
        // We need the original message to preserve image if any
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

    async sync() {
        await this.db.sync();
    }

    async comment(parentId: string, parentUserId: string, content: string, image?: Uint8Array) {
        await this.post(content, true, image, parentId, parentUserId);
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

        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        const myId = this.db.getConfig().paths.userId;

        for (const user of following) {
            // Derive shared secret for this user once
            const sharedSecret = this.db.deriveSharedSecret(user.publicKey);

            for (const date of dates) {
                const localPath = this.db.getModulePath(this.MODULE_NAME, `${user.userId}/dms/${date}.db`, 'followed');
                const data = await this.db.getStorage().getFile(localPath);
                if (data) {
                    const db = new this.sqliteInstance.Database(data);
                    try {
                        const res = db.exec('SELECT encrypted_data FROM messages');
                        if (res && res.length > 0) {
                            for (const row of res[0].values) {
                                try {
                                    // Try decrypting with shared secret (E2EE)
                                    const decrypted = await this.db.decrypt(row[0] as Uint8Array, sharedSecret);
                                    if (decrypted) {
                                        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Message;
                                        if (typeof (parsed as any).isEdited === 'number') parsed.isEdited = !!(parsed as any).isEdited;
                                        if (typeof (parsed as any).isDeleted === 'number') parsed.isDeleted = !!(parsed as any).isDeleted;
                                        messages.push(parsed);
                                    }
                                } catch (e) {
                                    // Fallback for older messages (non-E2EE) if needed, 
                                    // but we assume E2EE going forward.
                                }
                            }
                        }
                    } catch (e) {}
                    db.close();
                }
            }
        }

        // Also check my own outbox
        for (const date of dates) {
            const outboxPath = this.db.getModulePath(this.MODULE_NAME, `dms/outbox/${date}.db`, 'private');
            const data = await this.db.getStorage().getFile(outboxPath);
            if (data) {
                const db = new this.sqliteInstance.Database(data);
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

        // Deduplicate messages by ID, keeping the one with the latest timestamp (for edits)
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

    async updateProfile(name: string, bio: string, avatar?: string) {
        let finalAvatar = avatar;
        if (avatar && avatar.startsWith('data:image')) {
            try {
                finalAvatar = await SocialManager.compressImage(avatar, 100 * 1024);
            } catch (e: any) {
                Logger.warn(`[Social] Failed to compress avatar: ${e.message}`);
            }
        }
        const profile = { name, bio, avatar: finalAvatar, updatedAt: Date.now(), userId: this.db.getConfig().paths.userId };
        const data = new TextEncoder().encode(JSON.stringify(profile));
        await this.db.getStorage().savePublicUserFile(data);
    }

    public static async compressImage(dataUrl: string, targetSizeBytes: number): Promise<string> {
        if (typeof document === 'undefined') return dataUrl; 
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = dataUrl;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_DIM = 1024;
                if (width > MAX_DIM || height > MAX_DIM) {
                    if (width > height) {
                        height = (height / width) * MAX_DIM;
                        width = MAX_DIM;
                    } else {
                        width = (width / height) * MAX_DIM;
                        height = MAX_DIM;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Canvas context failed'));
                ctx.drawImage(img, 0, 0, width, height);

                let quality = 0.9;
                let result = dataUrl;
                const attempt = () => {
                    result = canvas.toDataURL('image/jpeg', quality);
                    const estimatedSize = result.length * 0.75;
                    if (estimatedSize > targetSizeBytes && quality > 0.1) {
                        quality -= 0.1;
                        attempt();
                    } else { resolve(result); }
                };
                attempt();
            };
            img.onerror = (e) => reject(e);
        });
    }

    async getProfile(userId?: string): Promise<any> {
        const myId = this.db.getConfig().paths.userId;
        const targetId = userId || myId;
        if (targetId === myId) {
            const data = await this.db.getStorage().getPublicUserFile();
            return data ? JSON.parse(new TextDecoder().decode(data)) : null;
        }
        const actualPath = this.db.getModulePath(this.MODULE_NAME, `${targetId}/profile`, 'followed');
        const finalData = await this.db.getStorage().getFile(actualPath);
        if (finalData) {
            return JSON.parse(new TextDecoder().decode(finalData));
        }
        return null;
    }

    async syncOtherProfiles() {
        const following = await this.db.getFollowing();
        for (const user of following) {
            const userRemote = (this.db as any).createRemote(user.userId);
            try {
                const cachedEtag = await this.db.getStorage().getGenericRemoteHashCache(`${user.userId}:public/user.json`);
                const result = await userRemote.downloadFile('public/user.json', cachedEtag || undefined);
                
                if (result && !result.notModified && result.data) {
                    const data = result.data;
                    let finalData = data;
                    try {
                        JSON.parse(new TextDecoder().decode(data));
                    } catch (e) {
                        try {
                            finalData = await this.db.decrypt(data, user.publicKey);
                        } catch (de) {
                            continue;
                        }
                    }
                    const localPath = this.db.getModulePath(this.MODULE_NAME, `${user.userId}/profile`, 'followed');
                    await this.db.getStorage().saveFile(localPath, finalData);
                    if (result.etag) {
                        await this.db.getStorage().setGenericRemoteHashCache(`${user.userId}:public/user.json`, result.etag);
                    }
                }
            } catch (e: any) {}
        }
    }

    async getPosts(date: string, type: 'private' | 'public' | 'followed'): Promise<Post[]> {
        const db = await this.getDb(date, type);
        let posts: Post[] = [];
        try {
            const res = db.exec('SELECT * FROM posts ORDER BY timestamp DESC');
            if (res && res.length > 0) {
                const columns = res[0].columns;
                posts = res[0].values.map((row: any) => {
                    const post: any = {};
                    columns.forEach((col: string, i: number) => {
                        let val = row[i];
                        if ((col === 'isEdited' || col === 'isDeleted') && typeof val === 'number') {
                            val = !!val;
                        }
                        post[col] = val;
                    });
                    if (!post.userId && type === 'followed') {
                        post.userId = date.split('/')[0];
                    }
                    return post;
                });
            }
        } catch (e: any) {
            posts = [];
        }
        db.close();
        return posts;
    }

    async enrichLikes(posts: Post[], days: number = 5) {
        if (posts.length === 0) return;
        const postMap = new Map<string, Post>();
        posts.forEach(p => {
            p.likesCount = 0;
            p.likedByMe = false;
            postMap.set(p.id, p);
        });
        const myId = this.db.getConfig().paths.userId;
        const following = await this.db.getFollowing();
        const dates: string[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(SovereignS3nc.getDateStr(d));
        }
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const processDb = async (date: string, type: 'public' | 'followed') => {
            const dbPath = type === 'followed' 
                ? this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed')
                : this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
            const data = await this.db.getStorage().getFile(dbPath);
            if (!data) return;
            const db = new this.sqliteInstance.Database(data);
            try {
                const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='likes'");
                if (tableCheck.length === 0) {
                    db.close();
                    return;
                }
                const res = db.exec('SELECT postId, userId FROM likes');
                if (res && res.length > 0) {
                    for (const row of res[0].values) {
                        const postId = row[0] as string;
                        const likerId = row[1];
                        const post = postMap.get(postId);
                        if (post) {
                            post.likesCount = (post.likesCount || 0) + 1;
                            if (likerId === myId) post.likedByMe = true;
                        }
                    }
                }
            } catch (e) {}
            db.close();
        };
        for (const date of dates) await processDb(date, 'public');
        for (const user of following) {
            for (const date of dates) await processDb(`${user.userId}/${date}`, 'followed');
        }
    }
}
