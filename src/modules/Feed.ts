
import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';
import { ModuleDefinition } from '../types';
import { env } from '../utils/Environment';
import { ModuleError } from '../utils/Errors';
import { DEFAULTS } from '../utils/Constants';
import { DailyDatabase } from '../core/DailyDatabase';

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
    private dailyDb: DailyDatabase;

    constructor(private db: SovereignS3nc) {
        this.dailyDb = this.db.getDailyDatabase(this.MODULE_NAME, { debounceMs: 500 });
        this.db.registerModule(FEED_MODULE_DEFINITION);
        this.db.registerModuleInstance(this);
    }

    private async getDb(date: string, type: 'private' | 'public' | 'followed' | 'group', groupId?: string, sharedKey?: string): Promise<any> {
        let dbPath: string;
        if (type === 'group' && groupId) {
            dbPath = `public/groups/${groupId}/${date}.db`;
            const session = await this.dailyDb.openDatabase(dbPath, {
                applySchema: true,
                encryptKey: sharedKey,
                decryptKey: sharedKey
            });
            return session.db;
        } else if (type === 'followed') {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed');
        } else {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type as any);
        }

        const session = await this.dailyDb.openDatabase(dbPath, { applySchema: true });
        return session.db;
    }

    async post(content: string, isPublic: boolean = true, image?: Uint8Array, parentId?: string, parentUserId?: string, expiresAt?: number) {
        if (content.length > DEFAULTS.MAX_POST_LENGTH) {
            throw new ModuleError('feed', `Post exceeds maximum length of ${DEFAULTS.MAX_POST_LENGTH} characters`);
        }
        
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const id = env.generateId(12);
        const timestamp = Date.now();
        const userId = this.db.getConfig().paths.userId;

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, isPublic);
        }

        const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, parentId, parentUserId, isEdited, isDeleted, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)';
        await this.dailyDb.withDailyDatabase(date, type, (db) => {
            db.run(sql, [id, content, timestamp, userId, imagePath, parentId || null, parentUserId || null, expiresAt ?? null]);
        }, { save: true, emitUpdate: true });
    }

    async editPost(postId: string, date: string, newContent: string, isPublic: boolean = true) {
        const type = isPublic ? 'public' : 'private';
        await this.dailyDb.withDailyDatabase(date, type, (db) => {
            db.run('UPDATE posts SET content = ?, isEdited = 1, timestamp = ? WHERE id = ?', [newContent, Date.now(), postId]);
        }, { save: true, emitUpdate: true });
    }

    async deletePost(postId: string, date: string, isPublic: boolean = true) {
        const type = isPublic ? 'public' : 'private';
        await this.dailyDb.withDailyDatabase(date, type, (db) => {
            db.run('UPDATE posts SET content = "", image = NULL, isDeleted = 1, timestamp = ? WHERE id = ?', [Date.now(), postId]);
        }, { save: true, emitUpdate: true });
        await this.compactDatabase(date, isPublic, false).catch(() => {});
    }

    async like(postId: string, isPublic: boolean = true) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const userId = this.db.getConfig().paths.userId;
        const timestamp = Date.now();

        await this.dailyDb.withDailyDatabase(date, type, (db) => {
            db.run('INSERT OR REPLACE INTO likes (postId, userId, timestamp) VALUES (?, ?, ?)', [postId, userId, timestamp]);
        }, { save: true, emitUpdate: true });
    }

    async comment(parentId: string, parentUserId: string, content: string, image?: Uint8Array) {
        await this.post(content, true, image, parentId, parentUserId);
    }

    async getPosts(date: string, type: 'private' | 'public' | 'followed'): Promise<Post[]> {
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        if (!(await this.dailyDb.exists(dbPath))) {
            return [];
        }
        let allPosts: Post[] = [];
        await this.dailyDb.withDatabase(dbPath, (db) => {
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
            }, { applySchema: true });

        return allPosts;
    }

    /**
     * Retrieves feed posts across a sliding date window (including UTC tomorrow for clock skew),
     * combining own public posts and followed users' posts, with like enrichment and sorting.
     */
    async getFeedPosts(days: number = 5, includeFollowed: boolean = true): Promise<Post[]> {
        const dates: string[] = [];
        for (let i = -1; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }

        const allPosts: Post[] = [];
        // 1. Fetch own public posts
        for (const date of dates) {
            const posts = await this.getPosts(date, 'public');
            allPosts.push(...posts);
        }

        // 2. Fetch followed users' public posts
        if (includeFollowed) {
            const following = await this.db.getFollowing();
            for (const user of following) {
                for (const date of dates) {
                    const posts = await this.getPosts(`${user.userId}/${date}`, 'followed');
                    allPosts.push(...posts);
                }
            }
        }

        // 3. Deduplicate by ID
        const postMap = new Map<string, Post>();
        for (const p of allPosts) {
            const existing = postMap.get(p.id);
            if (!existing || p.timestamp > existing.timestamp) {
                postMap.set(p.id, p);
            }
        }

        const deduplicated = Array.from(postMap.values());
        await this.enrichLikes(deduplicated, days);
        deduplicated.sort((a, b) => b.timestamp - a.timestamp);
        return deduplicated;
    }

    /**
     * Purges expired posts from a given date partition.
     */
    async cleanupExpired(date: string, isPublic: boolean = true): Promise<number> {
        const type = isPublic ? 'public' : 'private';
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        if (!(await this.dailyDb.exists(dbPath))) return 0;

        const now = Date.now();
        return await this.dailyDb.withDatabase(dbPath, (db) => {
            let deletedCount = 0;
            const countRes = db.exec('SELECT COUNT(*) FROM posts WHERE expiresAt IS NOT NULL AND expiresAt <= ?', [now]);
            if (countRes && countRes.length > 0 && countRes[0].values[0]) {
                deletedCount = Number(countRes[0].values[0][0]);
            }
            if (deletedCount > 0) {
                db.run('DELETE FROM posts WHERE expiresAt IS NOT NULL AND expiresAt <= ?', [now]);
                db.run('VACUUM');
            }
            return deletedCount;
        }, { save: true, emitUpdate: true, applySchema: true, immediate: true });
    }

    /**
     * Compacts feed SQLite databases by permanently purging deleted/tombstoned/expired posts
     * and running SQLite VACUUM to reclaim storage and IndexedDB quota.
     * Compaction runs if tombstone ratio >= 50% or if force is true.
     */
    async compactDatabase(date: string, isPublic: boolean = true, force: boolean = false): Promise<{
        compacted: boolean;
        originalSize: number;
        newSize: number;
        freedBytes: number;
        tombstoneRatio: number;
    }> {
        const type = isPublic ? 'public' : 'private';
        const dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        if (!(await this.dailyDb.exists(dbPath))) {
            return { compacted: false, originalSize: 0, newSize: 0, freedBytes: 0, tombstoneRatio: 0 };
        }
        const data = await this.db.getStorage().getFile(dbPath);
        const originalSize = data ? data.byteLength : 0;
        const now = Date.now();
        let compacted = false;
        let newSize = originalSize;
        let tombstoneRatio = 0;

        await this.dailyDb.withDatabase(dbPath, (db) => {
            const totalRes = db.exec('SELECT COUNT(*) FROM posts');
            const total = (totalRes && totalRes.length > 0 && totalRes[0].values[0]) ? Number(totalRes[0].values[0][0]) : 0;

            const tombstoneRes = db.exec('SELECT COUNT(*) FROM posts WHERE isDeleted = 1 OR (expiresAt IS NOT NULL AND expiresAt <= ?)', [now]);
            const tombstones = (tombstoneRes && tombstoneRes.length > 0 && tombstoneRes[0].values[0]) ? Number(tombstoneRes[0].values[0][0]) : 0;

            tombstoneRatio = total > 0 ? tombstones / total : 0;

            if (force || (tombstones >= 50 && tombstoneRatio >= 0.5)) {
                db.run('DELETE FROM posts WHERE isDeleted = 1 OR (expiresAt IS NOT NULL AND expiresAt <= ?)', [now]);
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

        const processDb = async (date: string, type: 'public' | 'followed') => {
            const dbPath = type === 'followed' 
                ? this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed')
                : this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);

            if (!(await this.dailyDb.exists(dbPath))) return;

            await this.dailyDb.withDatabase(dbPath, (db) => {
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
            }, { applySchema: true });
        };

        for (const date of dates) await processDb(date, 'public');
        for (const user of following) {
            for (const date of dates) await processDb(`${user.userId}/${date}`, 'followed');
        }
    }

    // --- Group logic ---
    
    async postToGroup(groupId: string, sharedKey: string, content: string, image?: Uint8Array, type: 'text' | 'system' = 'text') {
        const groups = await this.db.getGroups();
        const group = groups.find(g => g.id === groupId);
        const userId = this.db.getConfig().paths.userId;
        if (group) {
            const member = group.members.find(m => m.userId === userId);
            if (member?.permissions?.canPost === false) {
                throw new ModuleError('feed', `Permission denied: User ${userId} is not allowed to post in group ${groupId}`);
            }
        }

        const date = new Date().toISOString().split('T')[0];
        const id = env.generateId(12);
        const timestamp = Date.now();

        let imagePath = null;
        if (image) {
            imagePath = await this.db.saveBlob(image, true);
        }

        const dbPath = `public/groups/${groupId}/${date}.db`;
        await this.dailyDb.withDatabase(dbPath, (db) => {
            const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, isEdited, isDeleted, type) VALUES (?, ?, ?, ?, ?, 0, 0, ?)';
            db.run(sql, [id, content, timestamp, userId, imagePath, type]);
        }, {
            save: true,
            encryptKey: sharedKey,
            decryptKey: sharedKey,
            applySchema: true,
            emitUpdate: true
        });
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async editGroupPost(groupId: string, sharedKey: string, postId: string, date: string, newContent: string) {
        const dbPath = `public/groups/${groupId}/${date}.db`;
        const userId = this.db.getConfig().paths.userId;
        
        await this.dailyDb.withDatabase(dbPath, (db) => {
            const sql = `
                INSERT OR REPLACE INTO posts 
                (id, content, timestamp, userId, isEdited, isDeleted) 
                VALUES (?, ?, ?, ?, 1, 0)
            `;
            db.run(sql, [postId, newContent, Date.now(), userId]);
        }, {
            save: true,
            encryptKey: sharedKey,
            decryptKey: sharedKey,
            applySchema: true,
            emitUpdate: true
        });
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async deleteGroupPost(groupId: string, sharedKey: string, postId: string, date: string, authorId: string) {
        const myId = this.db.getConfig().paths.userId;
        const dbPath = `public/groups/${groupId}/${date}.db`;
        
        await this.dailyDb.withDatabase(dbPath, async (db) => {
            if (authorId === myId) {
                db.run('UPDATE posts SET content = "", image = NULL, isDeleted = 1, timestamp = ? WHERE id = ?', [Date.now(), postId]);
            } else {
                const groups = await this.db.getGroups();
                const group = groups.find(g => g.id === groupId);
                const member = group?.members.find(m => m.userId === myId);
                const canModerate = member?.role === 'owner' || member?.role === 'admin' || member?.permissions?.canModerate === true;
                if (!canModerate) {
                    throw new ModuleError('feed', `Permission denied: User ${myId} does not have moderation permission in group ${groupId}`);
                }
                db.run('CREATE TABLE IF NOT EXISTS moderation (targetId TEXT PRIMARY KEY, action TEXT, timestamp INTEGER)');
                db.run('INSERT OR REPLACE INTO moderation (targetId, action, timestamp) VALUES (?, ?, ?)', [postId, 'delete', Date.now()]);
            }
        }, {
            save: true,
            encryptKey: sharedKey,
            decryptKey: sharedKey,
            applySchema: true,
            emitUpdate: true
        });
        this.db.emit(`group:${groupId}:update`, { path: dbPath });
    }

    async getGroupPosts(groupId: string, date: string): Promise<Post[]> {
        const deletedPostIds = new Set<string>();

        const groups = await this.db.getGroups();
        const group = groups.find(g => g.id === groupId);
        if (!group) return [];

        const processModeration = (db: any, memberId: string) => {
            try {
                const member = group.members.find(m => m.userId === memberId);
                const canModerate = member?.role === 'owner' || member?.role === 'admin' || member?.permissions?.canModerate === true;
                if (!canModerate) return;

                const res = db.exec('SELECT targetId FROM moderation WHERE action = "delete"');
                if (res && res.length > 0) {
                    res[0].values.forEach((row: any) => {
                        deletedPostIds.add(row[0]);
                    });
                }
            } catch(e: any) {
                Logger.warn('Feed', `Failed to process moderation entries for member ${memberId}: ${e.message}`);
            }
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
            } catch (e: any) {
                Logger.warn('Feed', `Failed to process group posts: ${e.message}`);
            }
        };

        // 1. My data
        const myPath = `public/groups/${groupId}/${date}.db`;
        if (await this.dailyDb.exists(myPath)) {
            await this.dailyDb.withDatabase(myPath, async (db) => {
                processModeration(db, this.db.getConfig().paths.userId);
                await processPosts(db);
            }, { decryptKey: group.sharedKey, applySchema: true });
        }

        // 2. Member data
        for (const member of group.members) {
            if (member.userId === this.db.getConfig().paths.userId) continue;
            const memberPath = `followed/${member.userId}/groups/${groupId}/${date}.db`;
            
            if (await this.dailyDb.exists(memberPath)) {
                await this.dailyDb.withDatabase(memberPath, async (db) => {
                    processModeration(db, member.userId);
                    await processPosts(db);
                }, { decryptKey: group.sharedKey, applySchema: true });
            }
        }

        const posts = Array.from(postsMap.values());
        posts.sort((a, b) => b.timestamp - a.timestamp);
        return posts;
    }
}
