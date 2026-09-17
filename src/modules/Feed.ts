
import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';
import { ModuleDefinition } from '../types';
import { env } from '../utils/Environment';
import { ModuleError } from '../utils/Errors';
import { DEFAULTS } from '../utils/Constants';

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
    /** Optional expiration timestamp (Unix ms). Posts past this time are filtered out and cleaned up. */
    expiresAt?: number;
}

export const FEED_MODULE_DEFINITION: ModuleDefinition = {
    name: 'feed',
    tables: [
        {
            name: 'posts',
            schema: `
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                userId TEXT,
                image TEXT,
                parentId TEXT,
                parentUserId TEXT,
                isEdited INTEGER DEFAULT 0,
                isDeleted INTEGER DEFAULT 0,
                type TEXT DEFAULT 'text'
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
            version: 2,
            sql: ['ALTER TABLE posts ADD COLUMN expiresAt INTEGER DEFAULT NULL;']
        }
    ]
};

export class FeedModule {
    private readonly MODULE_NAME = 'feed';

    constructor(private db: SovereignS3nc) {
        this.db.registerModule(FEED_MODULE_DEFINITION);
    }

    private async getDb(date: string, type: 'private' | 'public' | 'followed' | 'group', groupId?: string, sharedKey?: string): Promise<any> {
        if (type === 'group' && groupId && sharedKey) {
            return this.db.getGroupStore(groupId, this.MODULE_NAME, date, sharedKey);
        }

        let dbPath: string;
        if (type === 'followed') {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed');
        } else {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type as any);
        }
            
        let data = await this.db.getStorage().getFile(dbPath);
        
        // Use env to get sql.js
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('feed', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});
        
        let db: any;
        try {
            db = new sqliteInstance.Database(data || undefined);
        } catch (e: any) {
            if (e.message?.includes('malformed') || e.message?.includes('not a database')) {
                Logger.error('Feed', `Database corruption detected at ${dbPath}. Deleting corrupted file.`);
                await this.db.getStorage().deleteFile(dbPath);
                // Return an empty DB for now, sync will recover it later
                db = new sqliteInstance.Database();
            } else {
                throw e;
            }
        }

        // Use Core Schema Management
        this.db.applyModuleSchema(db, this.MODULE_NAME);

        return db;
    }

    async post(content: string, isPublic: boolean = true, image?: Uint8Array, parentId?: string, parentUserId?: string, expiresAt?: number) {
        if (content.length > DEFAULTS.MAX_POST_LENGTH) {
            throw new ModuleError('feed', `Post exceeds maximum length of ${DEFAULTS.MAX_POST_LENGTH} characters`);
        }
        
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        const id = env.generateId(12);
        const timestamp = Date.now();
        const userId = this.db.getConfig().paths.userId;

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, isPublic);
        }

        const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, parentId, parentUserId, isEdited, isDeleted, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)';
        db.run(sql, [id, content, timestamp, userId, imagePath, parentId || null, parentUserId || null, expiresAt ?? null]);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();

        this.db.emit(`${this.MODULE_NAME}:update`, { path: dbPath });
    }

    async editPost(postId: string, date: string, newContent: string, isPublic: boolean = true) {
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        db.run('UPDATE posts SET content = ?, isEdited = 1, timestamp = ? WHERE id = ?', [newContent, Date.now(), postId]);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();

        this.db.emit(`${this.MODULE_NAME}:update`, { path: dbPath });
    }

    async deletePost(postId: string, date: string, isPublic: boolean = true) {
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        db.run('UPDATE posts SET content = "", image = NULL, isDeleted = 1, timestamp = ? WHERE id = ?', [Date.now(), postId]);

        const binary = db.export();
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        await this.db.getStorage().saveFile(dbPath, binary);
        db.close();

        this.db.emit(`${this.MODULE_NAME}:update`, { path: dbPath });
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

        this.db.emit(`${this.MODULE_NAME}:update`, { path: dbPath });
    }

    async comment(parentId: string, parentUserId: string, content: string, image?: Uint8Array) {
        await this.post(content, true, image, parentId, parentUserId);
    }

    async getPosts(date: string, type: 'private' | 'public' | 'followed'): Promise<Post[]> {
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);

        let allPosts: Post[] = [];

        // Use env to get sql.js
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('feed', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});

        const data = await this.db.getStorage().getFile(dbPath);
        if (data) {
            const db = new sqliteInstance.Database(data);
            try {
                const res = db.exec('SELECT * FROM posts ORDER BY timestamp DESC');
                if (res && res.length > 0) {
                    const columns = res[0].columns;
                    const now = Date.now();
                    const posts = res[0].values.map((row: any) => {
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
                        return post as Post;
                    }).filter((p: Post) => !p.expiresAt || p.expiresAt > now);
                    allPosts.push(...posts);
                }
            } catch (e) {}
            db.close();
        }

        return allPosts;
    }

    /**
     * Purges expired posts from a given date partition.
     */
    async cleanupExpired(date: string, isPublic: boolean = true): Promise<number> {
        const type = isPublic ? 'public' : 'private';
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        const data = await this.db.getStorage().getFile(dbPath);
        if (!data) return 0;

        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('feed', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});

        const db = new sqliteInstance.Database(data);
        const now = Date.now();
        let deletedCount = 0;
        try {
            const countRes = db.exec('SELECT COUNT(*) FROM posts WHERE expiresAt IS NOT NULL AND expiresAt <= ?', [now]);
            if (countRes && countRes.length > 0 && countRes[0].values[0]) {
                deletedCount = Number(countRes[0].values[0][0]);
            }
            if (deletedCount > 0) {
                db.run('DELETE FROM posts WHERE expiresAt IS NOT NULL AND expiresAt <= ?', [now]);
                const binary = db.export();
                await this.db.getStorage().saveFile(dbPath, binary);
                this.db.emit(`${this.MODULE_NAME}:update`, { path: dbPath });
            }
        } finally {
            db.close();
        }
        return deletedCount;
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
            dates.push(d.toISOString().split('T')[0]);
        }

        // Use env to get sql.js
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('feed', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});

        const processDb = async (date: string, type: 'public' | 'followed') => {
            const dbPath = type === 'followed' 
                ? this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed')
                : this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);

            const data = await this.db.getStorage().getFile(dbPath);
            if (!data) return;

            const db = new sqliteInstance.Database(data);
            try {
                const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='likes'");
                if (tableCheck.length > 0) {
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
                }
            } catch (e) {}
            db.close();
        };

        for (const date of dates) await processDb(date, 'public');
        for (const user of following) {
            for (const date of dates) await processDb(`${user.userId}/${date}`, 'followed');
        }
    }

    // --- Group logic ---
    
    async postToGroup(groupId: string, sharedKey: string, content: string, image?: Uint8Array, type: 'text' | 'system' = 'text') {
        const date = new Date().toISOString().split('T')[0];
        const db = await this.getDb(date, 'group', groupId, sharedKey);
        
        const id = env.generateId(12);
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
        
        const encrypted = await this.db.encrypt(binary, sharedKey);
        await this.db.getStorage().saveFile(dbPath, encrypted);
        
        db.close();
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async editGroupPost(groupId: string, sharedKey: string, postId: string, date: string, newContent: string) {
        const db = await this.getDb(date, 'group', groupId, sharedKey);
        const userId = this.db.getConfig().paths.userId;
        
        // Use INSERT OR REPLACE to support collaborative editing of posts created by others
        // We need all columns for the REPLACE to work if it hits the PK
        const sql = `
            INSERT OR REPLACE INTO posts 
            (id, content, timestamp, userId, isEdited, isDeleted) 
            VALUES (?, ?, ?, ?, 1, 0)
        `;
        db.run(sql, [postId, newContent, Date.now(), userId]);
        
        const binary = db.export();
        const dbPath = `public/groups/${groupId}/${date}.db`;
        const encrypted = await this.db.encrypt(binary, sharedKey);
        await this.db.getStorage().saveFile(dbPath, encrypted);
        db.close();
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async deleteGroupPost(groupId: string, sharedKey: string, postId: string, date: string, authorId: string) {
        const myId = this.db.getConfig().paths.userId;
        const db = await this.getDb(date, 'group', groupId, sharedKey);
        
        if (authorId === myId) {
            db.run('UPDATE posts SET content = "", image = NULL, isDeleted = 1, timestamp = ? WHERE id = ?', [Date.now(), postId]);
        } else {
            // Owner/Admin moderation
            db.run('CREATE TABLE IF NOT EXISTS moderation (targetId TEXT PRIMARY KEY, action TEXT, timestamp INTEGER)');
            db.run('INSERT OR REPLACE INTO moderation (targetId, action, timestamp) VALUES (?, ?, ?)', [postId, 'delete', Date.now()]);
        }
        
        const binary = db.export();
        const dbPath = `public/groups/${groupId}/${date}.db`;
        const encrypted = await this.db.encrypt(binary, sharedKey);
        await this.db.getStorage().saveFile(dbPath, encrypted);
        db.close();
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async getGroupPosts(groupId: string, date: string): Promise<Post[]> {
        const deletedPostIds = new Set<string>();
        
        // Use env to get sql.js
        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError('feed', 'sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});

        const groups = await this.db.getGroups();
        const group = groups.find(g => g.id === groupId);
        if (!group) return [];

        const processModeration = (db: any, memberId: string) => {
            try {
                const memberRole = group.members.find(m => m.userId === memberId)?.role;
                if (memberRole !== 'owner' && memberRole !== 'admin') return;

                const res = db.exec('SELECT targetId FROM moderation WHERE action = "delete"');
                if (res && res.length > 0) {
                    res[0].values.forEach((row: any) => {
                        deletedPostIds.add(row[0]);
                    });
                }
            } catch(e) {}
        };

        const postsMap = new Map<string, Post>();

        const processPosts = async (db: any) => {
            try {
                const res = db.exec('SELECT * FROM posts');
                if (res && res.length > 0) {
                    const columns = res[0].columns;
                    const batch = res[0].values
                        .map((row: any) => {
                            const post: any = {};
                            columns.forEach((col: string, i: number) => {
                                let val = row[i];
                                if ((col === 'isEdited' || col === 'isDeleted') && typeof val === 'number') val = !!val;
                                post[col] = val;
                            });
                            return post as Post;
                        });
                    
                    batch.forEach((p: Post) => {
                        if (p.isDeleted || deletedPostIds.has(p.id)) return;
                        
                        const existing = postsMap.get(p.id);
                        if (!existing || p.timestamp > existing.timestamp) {
                            postsMap.set(p.id, p);
                        }
                    });
                }
            } catch (e: any) {}
        };

        // 1. My data
        const myPath = `public/groups/${groupId}/${date}.db`;
        const myData = await this.db.getStorage().getFile(myPath);
        if (myData) {
            try {
                const decrypted = await this.db.decrypt(myData, group.sharedKey);
                const db = new sqliteInstance.Database(decrypted);
                processModeration(db, this.db.getConfig().paths.userId);
                await processPosts(db);
                db.close();
            } catch(e: any) {}
        }

        // 2. Member data
        for (const member of group.members) {
            if (member.userId === this.db.getConfig().paths.userId) continue;
            const memberPath = `followed/${member.userId}/groups/${groupId}/${date}.db`;
            
            const memberData = await this.db.getStorage().getFile(memberPath);
            if (memberData) {
                try {
                    const decrypted = await this.db.decrypt(memberData, group.sharedKey);
                    const db = new sqliteInstance.Database(decrypted);
                    processModeration(db, member.userId);
                    await processPosts(db);
                    db.close();
                } catch(e: any) {}
            }
        }

        const posts = Array.from(postsMap.values());
        posts.sort((a, b) => b.timestamp - a.timestamp);
        return posts;
    }
}
