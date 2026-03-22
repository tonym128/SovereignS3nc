
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
    migrations: [] // New module, so we start with the full schema
};

export class FeedModule {
    private readonly MODULE_NAME = 'feed';

    constructor(private db: SovereignS3nc) {
        this.db.registerModule(FEED_MODULE_DEFINITION);
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
                Logger.warn(`[Feed] Failed to decrypt group DB: ${e.message}`);
                data = null; 
            }
        }

        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const db = new sqliteInstance.Database(data || undefined);

        // Use Core Schema Management
        this.db.applyModuleSchema(db, this.MODULE_NAME);

        return db;
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
        db.run(sql, [id, content, timestamp, userId, imagePath, parentId || null, parentUserId || null]);

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
        // Compatibility: Check both new and old module paths
        const pathsToCheck = [
            this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type),
            this.db.getModulePath('social', `${date}.db`, type)
        ];

        let allPosts: Post[] = [];

        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        for (const dbPath of pathsToCheck) {
            const data = await this.db.getStorage().getFile(dbPath);
            if (!data) continue;

            const db = new sqliteInstance.Database(data);
            try {
                const res = db.exec('SELECT * FROM posts ORDER BY timestamp DESC');
                if (res && res.length > 0) {
                    const columns = res[0].columns;
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
                    });
                    allPosts.push(...posts);
                }
            } catch (e) {}
            db.close();
        }

        // Deduplicate by ID
        const postMap = new Map<string, Post>();
        allPosts.forEach(p => {
            const existing = postMap.get(p.id);
            if (!existing || p.timestamp > existing.timestamp) {
                postMap.set(p.id, p);
            }
        });

        const finalPosts = Array.from(postMap.values());
        finalPosts.sort((a, b) => b.timestamp - a.timestamp);
        return finalPosts;
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

        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        const processDb = async (date: string, type: 'public' | 'followed') => {
            const pathsToCheck = [
                type === 'followed' 
                    ? this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed')
                    : this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type),
                type === 'followed'
                    ? this.db.getModulePath('social', `${date}.db`, 'followed')
                    : this.db.getModulePath('social', `${date}.db`, type)
            ];

            for (const dbPath of pathsToCheck) {
                const data = await this.db.getStorage().getFile(dbPath);
                if (!data) continue;

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
            }
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
        const posts: Post[] = [];
        const deletedPostIds = new Set<string>();
        
        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});

        const groups = await this.db.getGroups();
        const group = groups.find(g => g.id === groupId);
        if (!group) return posts;

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
                        })
                        .filter((p: Post) => !deletedPostIds.has(p.id) && !p.isDeleted);
                    posts.push(...batch);
                }
            } catch (e) {}
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
            } catch(e) {}
        }

        // 2. Member data
        for (const member of group.members) {
            if (member.userId === this.db.getConfig().paths.userId) continue;
            const memberPath = `followed/${member.userId}/groups/${groupId}/${date}.db`;
            const memberData = await this.db.getStorage().getFile(memberPath);
            if (memberData) {
                try {
                    // Member data in their public folder should also be encrypted with group key if they are following conventions,
                    // but wait, members save their own contribution to their own prefix.
                    // For groups, everyone saves to their own prefix: followed/userId/groups/groupId/date.db
                    // We need to decrypt it with the group shared key.
                    const decrypted = await this.db.decrypt(memberData, group.sharedKey);
                    const db = new sqliteInstance.Database(decrypted);
                    processModeration(db, member.userId);
                    await processPosts(db);
                    db.close();
                } catch(e) {}
            }
        }

        posts.sort((a, b) => b.timestamp - a.timestamp);
        return posts;
    }
}
