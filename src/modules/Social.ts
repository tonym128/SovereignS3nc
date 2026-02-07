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
        `);

        // Migration: Ensure image column exists if table was created earlier
        try {
            db.exec('ALTER TABLE posts ADD COLUMN image TEXT;');
        } catch (e) {}
        try {
            db.exec('ALTER TABLE posts ADD COLUMN parentId TEXT;');
            db.exec('ALTER TABLE posts ADD COLUMN parentUserId TEXT;');
        } catch (e) {}

        return db;
    }

    async post(content: string, isPublic: boolean = true, image?: string, parentId?: string, parentUserId?: string) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const userId = (this.db as any).config.paths.userId;

        console.log(`[Social] Creating post. Image size: ${image ? Math.round(image.length / 1024) : 0} KB`);

        const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, parentId, parentUserId) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const params = [id, content, timestamp, userId, image || null, parentId || null, parentUserId || null];

        db.run(sql, params);

        // Always save back to storage
        const binary = db.export();
        await (this.db as any).storage.saveDailyDb(date, type, binary);
        
        db.close();
    }

    async comment(parentId: string, parentUserId: string, content: string, image?: string) {
        await this.post(content, true, image, parentId, parentUserId);
    }

    async updateProfile(name: string, bio: string, avatar?: string) {
        const profile = { name, bio, avatar, updatedAt: Date.now() };
        const data = new TextEncoder().encode(JSON.stringify(profile));
        await (this.db as any).storage.savePublicUserFile(data);
    }

    async getProfile(userId?: string): Promise<any> {
        if (!userId || userId === (this.db as any).config.paths.userId) {
            const data = await (this.db as any).storage.getPublicUserFile();
            return data ? JSON.parse(new TextDecoder().decode(data)) : null;
        }
        return null;
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
}
