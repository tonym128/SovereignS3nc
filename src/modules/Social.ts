import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';
import { ModuleDefinition } from '../types';

export interface Post {
    id: string;
    content: string;
    timestamp: number;
    userId: string;
    type?: 'text' | 'system';
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

export const SOCIAL_MODULE_DEFINITION: ModuleDefinition = {
    name: 'social',
    tables: [
        {
            name: 'posts',
            schema: `
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                userId TEXT
            `
        },
        {
            name: 'likes',
            schema: `
                postId TEXT,
                userId TEXT,
                timestamp INTEGER,
                PRIMARY KEY (postId, userId)
            `
        },
        {
            name: 'messages',
            schema: `
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                senderId TEXT,
                recipientId TEXT,
                image TEXT
            `
        },
        {
            name: 'moderation',
            schema: `
                targetId TEXT PRIMARY KEY,
                action TEXT,
                timestamp INTEGER
            `
        }
    ],
    migrations: [
        {
            version: 1,
            sql: [
                "ALTER TABLE posts ADD COLUMN image TEXT;",
                "ALTER TABLE posts ADD COLUMN parentId TEXT;",
                "ALTER TABLE posts ADD COLUMN parentUserId TEXT;",
                "ALTER TABLE posts ADD COLUMN isEdited INTEGER DEFAULT 0;",
                "ALTER TABLE posts ADD COLUMN isDeleted INTEGER DEFAULT 0;"
            ]
        },
        {
            version: 2,
            sql: [
                "ALTER TABLE messages ADD COLUMN isEdited INTEGER DEFAULT 0;",
                "ALTER TABLE messages ADD COLUMN isDeleted INTEGER DEFAULT 0;"
            ]
        },
        {
            version: 3,
            sql: [
                "ALTER TABLE posts ADD COLUMN type TEXT DEFAULT 'text';"
            ]
        },
        {
            version: 4,
            sql: [
                "CREATE TABLE IF NOT EXISTS moderation (targetId TEXT PRIMARY KEY, action TEXT, timestamp INTEGER);"
            ]
        }
    ]
};

export class SocialManager {
    private sqliteInstance: any = null;
    private readonly MODULE_NAME = 'social';

    constructor(private db: SovereignS3nc) {
        this.db.registerModule(SOCIAL_MODULE_DEFINITION);
    }

    private async getDb(date: string, type: 'private' | 'public' | 'followed' | 'group', groupId?: string, sharedKey?: string): Promise<any> {
        let dbPath: string;
        if (type === 'followed') {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed');
        } else if (type === 'group' && groupId) {
            dbPath = `public/groups/${groupId}/${date}.db`;
        } else {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type as any);
        }
            
        let data = await this.db.getStorage().getFile(dbPath);
        
        // Handle Group Decryption
        if (data && type === 'group' && sharedKey) {
            try {
                data = await this.db.decrypt(data, sharedKey);
            } catch (e: any) {
                Logger.warn(`[Social] Failed to decrypt group DB: ${e.message}`);
                // If decryption fails, we start with a fresh DB to avoid "file is not a database" errors
                data = null; 
            }
        }

        const initSqlJs = (globalThis as any).initSqlJs;
        if (!initSqlJs) {
            throw new Error('sql.js not found. Ensure it is loaded in the environment.');
        }

        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        }
        const db = new this.sqliteInstance.Database(data || undefined);

        // Use Core Schema Management
        this.db.applyModuleSchema(db, this.MODULE_NAME);

        return db;
    }

    async postToGroup(groupId: string, sharedKey: string, content: string, image?: Uint8Array, type: 'text' | 'system' = 'text') {
        const date = new Date().toISOString().split('T')[0];
        const db = await this.getDb(date, 'group', groupId, sharedKey);
        
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const userId = this.db.getConfig().paths.userId;

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, true);
        }

        const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, isEdited, isDeleted, type) VALUES (?, ?, ?, ?, ?, 0, 0, ?)';
        db.run(sql, [id, content, timestamp, userId, imagePath, type]);

        const binary = db.export();
        const dbPath = `public/groups/${groupId}/${date}.db`;
        
        // Encrypt with Group Shared Key
        const encrypted = await this.db.encrypt(binary, sharedKey);
        await this.db.getStorage().saveFile(dbPath, encrypted);
        
        db.close();
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async editGroupPost(groupId: string, sharedKey: string, postId: string, date: string, newContent: string) {
        const db = await this.getDb(date, 'group', groupId, sharedKey);
        
        db.run('UPDATE posts SET content = ?, isEdited = 1, timestamp = ? WHERE id = ?', [newContent, Date.now(), postId]);

        const binary = db.export();
        const dbPath = `public/groups/${groupId}/${date}.db`;
        
        const encrypted = await this.db.encrypt(binary, sharedKey);
        await this.db.getStorage().saveFile(dbPath, encrypted);
        
        db.close();
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async deleteGroupPost(groupId: string, sharedKey: string, postId: string, date: string, authorId: string) {
        // If I am the author, I delete from my own DB
        // If I am the owner (and not author), I write a "tombstone" or just delete it if I'm editing the author's DB?
        // Wait, in this decentralized model, the owner CANNOT edit the author's DB file in S3 directly.
        // However, the owner CAN post a "MODERATION" record in their own group DB that says "Delete this post".
        // For simplicity in this demo, we'll assume:
        // 1. Author deletes from their own DB.
        // 2. Owner posts a system message or we add a 'moderation' table.
        
        // Let's implement author deletion first.
        const myId = this.db.getConfig().paths.userId;
        if (authorId === myId) {
            const db = await this.getDb(date, 'group', groupId, sharedKey);
            db.run('UPDATE posts SET content = "", image = NULL, isDeleted = 1, timestamp = ? WHERE id = ?', [Date.now(), postId]);
            
            const binary = db.export();
            const dbPath = `public/groups/${groupId}/${date}.db`;
            const encrypted = await this.db.encrypt(binary, sharedKey);
            await this.db.getStorage().saveFile(dbPath, encrypted);
            db.close();
            this.db.emit(`group:${groupId}:update`, { path: dbPath });
        } else {
            // Owner deletion: We'll add a 'moderation' table to the schema
            // For now, let's just allow authors to delete.
            // Wait, the prompt asked for "allow owner to delete messages".
            // I will add a 'deleted_posts' table to the social schema for moderation.
            const db = await this.getDb(date, 'group', groupId, sharedKey);
            db.run('CREATE TABLE IF NOT EXISTS moderation (targetId TEXT PRIMARY KEY, action TEXT, timestamp INTEGER)');
            db.run('INSERT OR REPLACE INTO moderation (targetId, action, timestamp) VALUES (?, ?, ?)', [postId, 'delete', Date.now()]);
            
            const binary = db.export();
            const dbPath = `public/groups/${groupId}/${date}.db`;
            const encrypted = await this.db.encrypt(binary, sharedKey);
            await this.db.getStorage().saveFile(dbPath, encrypted);
            db.close();
            this.db.emit(`group:${groupId}:update`, { path: dbPath });
        }
    }

    async getGroupPosts(groupId: string, date: string): Promise<Post[]> {
        const posts: Post[] = [];
        const deletedPostIds = new Set<string>();
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        const groups = await this.db.getGroups();
        const group = groups.find(g => g.id === groupId);
        if (!group) return posts;

        // 1. Collect all moderation entries from all members
        // In a real app, we would only trust moderation from Owner/Admin.
        const processModeration = (db: any, memberId: string) => {
            try {
                const memberRole = group.members.find(m => m.userId === memberId)?.role;
                if (memberRole !== 'owner' && memberRole !== 'admin') return;

                const res = db.exec('SELECT targetId FROM moderation WHERE action = "delete"');
                if (res && res.length > 0) {
                    res[0].values.forEach((row: any) => deletedPostIds.add(row[0]));
                }
            } catch(e) {}
        };

        // 1.1 Check my own moderation
        const myPath = `public/groups/${groupId}/${date}.db`;
        const myData = await this.db.getStorage().getFile(myPath);
        if (myData) {
            try {
                const decrypted = await this.db.decrypt(myData, group.sharedKey);
                const db = new this.sqliteInstance.Database(decrypted);
                processModeration(db, this.db.getConfig().paths.userId);
                db.close();
            } catch(e) {}
        }

        // 1.2 Check other members moderation
        for (const member of group.members) {
            if (member.userId === this.db.getConfig().paths.userId) continue;
            const memberPath = `followed/${member.userId}/groups/${groupId}/${date}.db`;
            const memberData = await this.db.getStorage().getFile(memberPath);
            if (memberData) {
                const db = new this.sqliteInstance.Database(memberData);
                processModeration(db, member.userId);
                db.close();
            }
        }

        // 2. Query posts, filtering out moderated ones
        // 2.1 My posts
        if (myData) {
            try {
                const decrypted = await this.db.decrypt(myData, group.sharedKey);
                const db = new this.sqliteInstance.Database(decrypted);
                posts.push(...(await this._queryPosts(db, deletedPostIds)));
                db.close();
            } catch(e) {}
        }

        // 2.2 Other member posts
        for (const member of group.members) {
            if (member.userId === this.db.getConfig().paths.userId) continue;
            const memberPath = `followed/${member.userId}/groups/${groupId}/${date}.db`;
            const memberData = await this.db.getStorage().getFile(memberPath);
            if (memberData) {
                const db = new this.sqliteInstance.Database(memberData);
                posts.push(...(await this._queryPosts(db, deletedPostIds)));
                db.close();
            }
        }

        posts.sort((a, b) => b.timestamp - a.timestamp);
        return posts;
    }

    private async _queryPosts(db: any, deletedIds: Set<string> = new Set()): Promise<Post[]> {
        try {
            const res = db.exec('SELECT * FROM posts');
            if (res && res.length > 0) {
                const columns = res[0].columns;
                return res[0].values
                    .map((row: any) => {
                        const post: any = {};
                        columns.forEach((col: string, i: number) => {
                            let val = row[i];
                            if ((col === 'isEdited' || col === 'isDeleted') && typeof val === 'number') val = !!val;
                            post[col] = val;
                        });
                        return post;
                    })
                    .filter((p: Post) => !deletedIds.has(p.id) && !p.isDeleted);
            }
        } catch (e) {}
        return [];
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

        this.db.onModuleUpdate(this.MODULE_NAME, dbPath);
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

        this.db.onModuleUpdate(this.MODULE_NAME, dbPath);
    }

    async editPost(postId: string, date: string, newContent: string, isPublic: boolean = true) {
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        db.run('UPDATE posts SET content = ?, isEdited = 1, timestamp = ? WHERE id = ?', [newContent, Date.now(), postId]);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();

        this.db.onModuleUpdate(this.MODULE_NAME, dbPath);
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

        this.db.onModuleUpdate(this.MODULE_NAME, dbPath);
    }

    async getMessageDb(date: string, type: 'inbox' | 'outbox'): Promise<any> {
        const path = this.db.getModulePath(this.MODULE_NAME, `dms/${type}/${date}.db`, 'private');
        const data = await this.db.getStorage().getFile(path);
        
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        }
        const db = new this.sqliteInstance.Database(data || undefined);

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
        const publicDmPath = this.db.getModulePath(this.MODULE_NAME, `dms/${recipientId}/${date}.db`, 'public');
        const publicDmData = await this.db.getStorage().getFile(publicDmPath);
        
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const publicDb = new this.sqliteInstance.Database(publicDmData || undefined);
        
        // Manual Schema for DM transport (not part of declarative module schema as it is a transport db)
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

        this.db.onModuleUpdate(this.MODULE_NAME, outboxPath);
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
                const localPath = this.db.getModulePath(this.MODULE_NAME, `${user.userId}/dms/${myId}/${date}.db`, 'followed');
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
        
        this.db.onModuleUpdate(this.MODULE_NAME, 'public/user.json');
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
                    this.db.onModuleUpdate(this.MODULE_NAME, localPath);
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
