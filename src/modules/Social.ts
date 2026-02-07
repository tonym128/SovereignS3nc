import { SovereignS3nc } from '../SovereignS3nc';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface Post {
    id: string;
    content: string;
    timestamp: number;
    userId: string;
    image?: string; // Base64 or URL
}

export class SocialManager {
    private sqliteInstance: any = null;

    constructor(private db: SovereignS3nc, private localPath: string, private sqliteProvider?: any) {}

    private async getDb(date: string, type: 'private' | 'public' | 'followed'): Promise<any> {
        const isBrowser = typeof window !== 'undefined';
        const datePath = type === 'followed' ? date : `${type}/${date}`;
        
        const data = await (this.db as any).storage.getDailyDb(date, type);
        
        let db: any;
        if (isBrowser) {
            const initSqlJs = (window as any).initSqlJs;
            if (!this.sqliteInstance) {
                this.sqliteInstance = await initSqlJs();
            }
            db = new this.sqliteInstance.Database(data || undefined);
        } else {
            const Database = eval('require')('better-sqlite3');
            const dir = path.join(this.localPath, type === 'followed' ? 'followed' : type);
            await fs.ensureDir(dir);
            const dbPath = path.join(dir, type === 'followed' ? `${date}.db` : `${date}.db`);
            db = new Database(dbPath);
        }

        // Initialize Schema
        db.run(`
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
        return db;
    }

    async post(content: string, isPublic: boolean = true, image?: string, parentId?: string, parentUserId?: string) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const db = await this.getDb(date, type);
        
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const userId = (this.db as any).config.paths.userId;

        const sql = 'INSERT INTO posts (id, content, timestamp, userId, image, parentId, parentUserId) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const params = [id, content, timestamp, userId, image || null, parentId || null, parentUserId || null];

        if (typeof db.prepare === 'function') {
            db.prepare(sql).run(...params);
        } else {
            db.run(sql, params);
        }

        if (typeof window !== 'undefined') {
            await (this.db as any).storage.saveDailyDb(date, type, db.export());
        }
        if (db.close) db.close();
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
        // If no userId, get own profile
        if (!userId || userId === (this.db as any).config.paths.userId) {
            const data = await (this.db as any).storage.getPublicUserFile();
            return data ? JSON.parse(new TextDecoder().decode(data)) : null;
        }
        // Discovery logic for other users would go here
        return null;
    }

    async getPosts(date: string, type: 'private' | 'public' | 'followed'): Promise<Post[]> {
        const db = await this.getDb(date, type);
        let posts: Post[] = [];

        if (typeof db.prepare === 'function') {
            posts = db.prepare('SELECT * FROM posts ORDER BY timestamp DESC').all();
        } else {
            const res = db.exec('SELECT * FROM posts ORDER BY timestamp DESC');
            if (res.length > 0) {
                const columns = res[0].columns;
                posts = res[0].values.map((row: any) => {
                    const post: any = {};
                    columns.forEach((col: string, i: number) => post[col] = row[i]);
                    return post;
                });
            }
        }

        if (db.close) db.close();
        return posts;
    }
}
