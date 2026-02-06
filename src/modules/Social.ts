import { SovereignS3nc } from '../SovereignS3nc';
import Database from 'better-sqlite3';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface Post {
    id: string;
    content: string;
    timestamp: number;
    userId: string;
}

export class SocialManager {
    constructor(private db: SovereignS3nc, private localPath: string) {}

    private async getDb(date: string, type: 'private' | 'public'): Promise<Database.Database> {
        const dir = path.join(this.localPath, type);
        await fs.ensureDir(dir);
        const dbPath = path.join(dir, `${date}.db`);
        const sqlite = new Database(dbPath);
        
        // Initialize Schema
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                userId TEXT
            );
        `);
        return sqlite;
    }

    async post(content: string, isPublic: boolean = true) {
        const date = new Date().toISOString().split('T')[0];
        const type = isPublic ? 'public' : 'private';
        const sqlite = await this.getDb(date, type);
        
        const id = Math.random().toString(36).substring(7);
        const timestamp = Date.now();
        const userId = 'me'; // In real app, get from config

        const stmt = sqlite.prepare('INSERT INTO posts (id, content, timestamp, userId) VALUES (?, ?, ?, ?)');
        stmt.run(id, content, timestamp, userId);
        sqlite.close();
    }

    async getPosts(date: string, type: 'private' | 'public'): Promise<Post[]> {
        const dbPath = path.join(this.localPath, type, `${date}.db`);
        if (!await fs.pathExists(dbPath)) return [];

        const sqlite = new Database(dbPath);
        const posts = sqlite.prepare('SELECT * FROM posts ORDER BY timestamp DESC').all() as Post[];
        sqlite.close();
        return posts;
    }
}
