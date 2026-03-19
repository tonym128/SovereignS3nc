import { SovereignS3nc } from '../SovereignS3nc';
import * as path from 'path';

export interface Post {
    id: string;
    content: string;
    timestamp: number;
    userId: string;
    image?: string; // Base64 or URL
    parentId?: string;
    parentUserId?: string;
    likesCount?: number;
    likedByMe?: boolean;
}

export class SocialManager {
    private sqliteInstance: any = null;

    constructor(private db: SovereignS3nc, private localPath: string, private sqliteProvider?: any) {}

    private async getDb(date: string, type: 'private' | 'public' | 'followed'): Promise<any> {
        const data = await (this.db as any).storage.getDailyDb(date, type);
        
        console.log(`[Social] getDb: ${type}/${date} (found locally: ${!!data})`);

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
                parentUserId TEXT
            );
            CREATE TABLE IF NOT EXISTS likes (
                postId TEXT,
                userId TEXT,
                timestamp INTEGER,
                PRIMARY KEY (postId, userId)
            );
        `);

        // Migration: Ensure image column exists if table was created earlier
        try {
            db.exec('ALTER TABLE posts ADD COLUMN image TEXT;');
        } catch (e) {}
        try {
            db.exec('ALTER TABLE posts ADD COLUMN parentId TEXT;');
            db.exec('ALTER TABLE posts ADD COLUMN parentUserId TEXT;');
        } catch (e) {}
        try {
            db.exec('CREATE TABLE IF NOT EXISTS likes (postId TEXT, userId TEXT, timestamp INTEGER, PRIMARY KEY (postId, userId));');
        } catch (e) {}

        return db;
    }

    async like(postId: string, isPublic: boolean = true) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        const userId = (this.db as any).config.paths.userId;
        const timestamp = Date.now();

        db.run('INSERT OR REPLACE INTO likes (postId, userId, timestamp) VALUES (?, ?, ?)', [postId, userId, timestamp]);

        // Always save back to storage
        const binary = db.export();
        await (this.db as any).storage.saveDailyDb(date, type, binary);
        
        db.close();
    }

    async post(content: string, isPublic: boolean = true, image?: Uint8Array, parentId?: string, parentUserId?: string) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const userId = (this.db as any).config.paths.userId;

        let imagePath = null;
        if (image) {
            console.log(`[Social] Saving image blob... Size: ${Math.round(image.length / 1024)} KB`);
            imagePath = await this.db.saveBlob(image, isPublic);
        }

        const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, parentId, parentUserId) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const params = [id, content, timestamp, userId, imagePath, parentId || null, parentUserId || null];

        db.run(sql, params);

        // Always save back to storage
        const binary = db.export();
        await (this.db as any).storage.saveDailyDb(date, type, binary);
        
        db.close();
    }

    async getMessageDb(date: string, type: 'inbox' | 'outbox'): Promise<any> {
        const path = `private/dms/${type}/${date}`;
        const data = await (this.db as any).storage.getFile(path);
        
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
                image TEXT
            );
        `);

        return db;
    }

    async sendDirectMessage(recipientId: string, content: string, image?: Uint8Array) {
        const date = new Date().toISOString().split('T')[0];
        const outboxDb = await this.getMessageDb(date, 'outbox');
        
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const senderId = (this.db as any).config.paths.userId;

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, false); // Private blob
        }

        outboxDb.run('INSERT INTO messages (id, content, timestamp, senderId, recipientId, image) VALUES (?, ?, ?, ?, ?, ?)', 
            [id, content, timestamp, senderId, recipientId, imagePath]);

        await (this.db as any).storage.saveFile(`private/dms/outbox/${date}`, outboxDb.export());
        outboxDb.close();

        // Public Daily DB for this recipient
        const publicDmPath = `public/dms/${recipientId}/${date}.db`;
        const publicDmData = await (this.db as any).storage.getFile(publicDmPath);
        
        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const publicDb = new this.sqliteInstance.Database(publicDmData || undefined);
        publicDb.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, encrypted_data BLOB);`);

        const message = { id, content, timestamp, senderId, recipientId, imagePath };
        const recipient = (await this.db.getPublicRegistry()).find(u => u.userId === recipientId);
        if (!recipient) throw new Error('Recipient not found in registry');

        const encrypted = await (this.db as any).encrypt(new TextEncoder().encode(JSON.stringify(message)), recipient.publicKey);
        publicDb.run('INSERT INTO messages (id, encrypted_data) VALUES (?, ?)', [id, encrypted]);

        await (this.db as any).storage.saveFile(publicDmPath, publicDb.export());
        publicDb.close();
        
        console.log(`[Social] DM sent and added to daily public DB for ${recipientId}`);
    }

    async sync() {
        await this.db.sync();
        await this.syncDirectMessages();
    }

    async syncDirectMessages() {
        console.log('[Social] Syncing DMs...');
        const myId = (this.db as any).config.paths.userId;
        const following = await this.db.getFollowing();
        
        for (const user of following) {
            const userRemote = (this.db as any).createRemote(user.userId);
            // This is the tricky part: how do we know which files to download?
            // S3 listing would be ideal, but we'll try a convention or just skip if no listing.
            // For this demo, let's assume we can list or we have a known path.
            // If we can't list, we'd need a 'daily index' of DMs.
        }
    }

    async comment(parentId: string, parentUserId: string, content: string, image?: Uint8Array) {
        await this.post(content, true, image, parentId, parentUserId);
    }

    async getInboxMessages(days: number = 5): Promise<any[]> {
        const myId = (this.db as any).config.paths.userId;
        const messages: any[] = [];
        
        const following = await this.db.getFollowing();
        
        // Check for specified number of days
        const dates: string[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }

        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        for (const user of following) {
            for (const date of dates) {
                const localPath = `followed/${user.userId}/dms/${date}.db`;
                const data = await (this.db as any).storage.getFile(localPath);
                if (data) {
                    const db = new this.sqliteInstance.Database(data);
                    try {
                        const res = db.exec('SELECT encrypted_data FROM messages');
                        if (res && res.length > 0) {
                            for (const row of res[0].values) {
                                let decrypted = null;
                                try {
                                    decrypted = await (this.db as any).decrypt(row[0], (this.db as any).config.encryptionKey);
                                } catch (e) {
                                    try {
                                        decrypted = await (this.db as any).decrypt(row[0], (this.db as any).config.publicEncryptionKey);
                                    } catch (e2: any) {}
                                }

                                if (decrypted) {
                                    const parsed = JSON.parse(new TextDecoder().decode(decrypted));
                                    messages.push(parsed);
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
            const outboxPath = `private/dms/outbox/${date}`;
            const data = await (this.db as any).storage.getFile(outboxPath);
            if (data) {
                const db = new this.sqliteInstance.Database(data);
                try {
                    const res = db.exec('SELECT * FROM messages');
                    if (res && res.length > 0) {
                        const columns = res[0].columns;
                        const myMsgs = res[0].values.map((row: any) => {
                            const msg: any = {};
                            columns.forEach((col: string, i: number) => msg[col] = row[i]);
                            return msg;
                        });
                        messages.push(...myMsgs);
                    }
                } catch (e) {}
                db.close();
            }
        }

        messages.sort((a, b) => b.timestamp - a.timestamp);
        return messages;
    }

    async updateProfile(name: string, bio: string, avatar?: string) {
        let finalAvatar = avatar;
        
        if (avatar && avatar.startsWith('data:image')) {
            try {
                finalAvatar = await SocialManager.compressImage(avatar, 200 * 1024);
                console.log(`[Social] Profile avatar compressed. Length: ${finalAvatar.length}`);
            } catch (e: any) {
                console.warn(`[Social] Failed to compress avatar: ${e.message}`);
            }
        }

        const profile = { name, bio, avatar: finalAvatar, updatedAt: Date.now(), userId: (this.db as any).config.paths.userId };
        const data = new TextEncoder().encode(JSON.stringify(profile));
        await (this.db as any).storage.savePublicUserFile(data);
    }

    /**
     * Utility to compress a base64 image (data URL) to a target size in bytes.
     */
    public static async compressImage(dataUrl: string, targetSizeBytes: number): Promise<string> {
        if (typeof document === 'undefined') return dataUrl; // Only works in browser

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = dataUrl;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Max dimensions to speed up
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
                    // Approximate size of base64: length * 0.75
                    const estimatedSize = result.length * 0.75;
                    
                    if (estimatedSize > targetSizeBytes && quality > 0.1) {
                        quality -= 0.1;
                        attempt();
                    } else {
                        resolve(result);
                    }
                };

                attempt();
            };
            img.onerror = (e) => reject(e);
        });
    }

    async getProfile(userId?: string): Promise<any> {
        const myId = (this.db as any).config.paths.userId;
        const targetId = userId || myId;

        if (targetId === myId) {
            const data = await (this.db as any).storage.getPublicUserFile();
            return data ? JSON.parse(new TextDecoder().decode(data)) : null;
        }

        // Check if we have their profile locally
        const data = await (this.db as any).storage.getDailyDb(`${targetId}/profile`, 'followed' as any);
        if (data) {
            return JSON.parse(new TextDecoder().decode(data));
        }
        return null;
    }

    async syncOtherProfiles() {
        const following = await this.db.getFollowing();
        console.log(`[Social] Syncing profiles for ${following.length} users...`);
        for (const user of following) {
            const userRemote = (this.db as any).createRemote(user.userId);
            try {
                const result = await userRemote.downloadFile('public/user.json');
                if (result && result.data) {
                    const data = result.data;
                    // Public user.json is NOT encrypted at rest in SovereignS3nc (unlike daily DBs)
                    // unless specified, but SocialManager.updateProfile doesn't encrypt it.
                    // SovereignS3nc.syncUserFile might encrypt it if key is provided.
                    // In current implementation of syncUserFile, it uses publicEncryptionKey.
                    
                    let finalData = data;
                    try {
                        // Try decrypting if it looks like encrypted data (starts with IV)
                        // but usually it's just JSON. Let's try to parse first.
                        JSON.parse(new TextDecoder().decode(data));
                    } catch (e) {
                        // If parse fails, it might be encrypted
                        try {
                            finalData = await (this.db as any).decrypt(data, user.publicKey);
                        } catch (de) {
                            console.warn(`[Social] Could not parse or decrypt profile for ${user.userId}`);
                            continue;
                        }
                    }

                    await (this.db as any).storage.saveDailyDb(`${user.userId}/profile`, 'followed' as any, finalData);
                    console.log(`[Social] Synced profile for ${user.userId}`);
                } else {
                    console.log(`[Social] No profile file found for ${user.userId}`);
                }
            } catch (e: any) {
                console.warn(`[Social] Failed to sync profile for ${user.userId}: ${e.message}`);
            }
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
                    columns.forEach((col: string, i: number) => post[col] = row[i]);
                    // If the row didn't have a userId (legacy or bug), use the folder name
                    if (!post.userId && type === 'followed') {
                        post.userId = date.split('/')[0];
                    }
                    return post;
                });
            }
        } catch (e: any) {
            console.warn(`[Social] Query failed for ${type}/${date}: ${e.message}`);
            posts = [];
        }

        db.close();
        console.log(`[Social] Found ${posts.length} posts in ${type}/${date}`);
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

        const myId = (this.db as any).config.paths.userId;
        const following = await this.db.getFollowing();
        
        // Check for specified number of days
        const dates: string[] = [];
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(SovereignS3nc.getDateStr(d));
        }

        const initSqlJs = (globalThis as any).initSqlJs;
        if (!this.sqliteInstance) this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        const processDb = async (date: string, type: 'public' | 'followed') => {
            const data = await (this.db as any).storage.getDailyDb(date, type);
            if (!data) return;

            const db = new this.sqliteInstance.Database(data);
            try {
                // Check if likes table exists
                const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='likes'");
                if (tableCheck.length === 0) {
                    db.close();
                    return;
                }

                const res = db.exec('SELECT postId, userId FROM likes');
                if (res && res.length > 0) {
                    for (const row of res[0].values) {
                        const postId = row[0];
                        const likerId = row[1];
                        const post = postMap.get(postId);
                        if (post) {
                            post.likesCount = (post.likesCount || 0) + 1;
                            if (likerId === myId) {
                                post.likedByMe = true;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn(`[Social] Failed to process likes in ${type}/${date}:`, e);
            }
            db.close();
        };

        // Scan our own likes
        for (const date of dates) {
            await processDb(date, 'public');
        }

        // Scan followed users' likes
        for (const user of following) {
            for (const date of dates) {
                await processDb(`${user.userId}/${date}`, 'followed' as any);
            }
        }
    }
}
