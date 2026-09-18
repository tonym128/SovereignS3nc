import { SovereignS3nc } from '../SovereignS3nc';
import { env } from '../utils/Environment';
import { RepositoryError } from '../utils/Errors';

export interface RepositoryOptions {
    idColumn?: string;
    datePartition?: string;
    type?: 'public' | 'private';
}

function validateIdentifier(name: string, type: 'table' | 'column'): string {
    if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new RepositoryError(
            `Invalid ${type} identifier: "${name}". Identifiers must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to prevent SQL injection.`
        );
    }
    return name;
}

export class Repository<T extends Record<string, any>> {
    public readonly moduleName: string;
    public readonly tableName: string;
    public readonly idColumn: string;
    public readonly datePartition: string;
    public readonly type: 'public' | 'private';

    constructor(
        private sov: SovereignS3nc,
        moduleName: string,
        tableName: string,
        options?: RepositoryOptions
    ) {
        this.moduleName = moduleName;
        this.tableName = validateIdentifier(tableName, 'table');
        this.idColumn = validateIdentifier(options?.idColumn || 'id', 'column');
        this.datePartition = options?.datePartition || new Date().toISOString().split('T')[0];
        this.type = options?.type || 'public';
    }

    private async getDb(): Promise<{ db: any; close: () => void; save: () => Promise<void> }> {
        const dbPath = this.sov.getModulePath(this.moduleName, `${this.datePartition}.db`, this.type);
        const data = await this.sov.getStorage().getFile(dbPath);

        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new RepositoryError('sql.js not loaded');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});

        const db = new sqliteInstance.Database(data || undefined);

        // Apply registered module schema if available
        this.sov.applyModuleSchema(db, this.moduleName);

        const save = async () => {
            const binary = db.export();
            await this.sov.getStorage().saveFile(dbPath, binary);
            this.sov.emit(`${this.moduleName}:update`, { path: dbPath });
        };

        const close = () => {
            db.close();
        };

        return { db, close, save };
    }

    public async find(query?: Partial<T>): Promise<T[]> {
        const { db, close } = await this.getDb();
        try {
            if (!query || Object.keys(query).length === 0) {
                const stmt = db.prepare(`SELECT * FROM "${this.tableName}"`);
                const rows: T[] = [];
                while (stmt.step()) {
                    rows.push(stmt.getAsObject() as T);
                }
                stmt.free();
                return rows;
            }

            const keys = Object.keys(query);
            const clauses = keys.map(k => {
                validateIdentifier(k, 'column');
                return `"${k}" = ?`;
            });
            const values = keys.map(k => (query as any)[k]);

            const stmt = db.prepare(`SELECT * FROM "${this.tableName}" WHERE ${clauses.join(' AND ')}`);
            stmt.bind(values);

            const rows: T[] = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject() as T);
            }
            stmt.free();
            return rows;
        } finally {
            close();
        }
    }

    public async findById(id: string): Promise<T | null> {
        const { db, close } = await this.getDb();
        try {
            const stmt = db.prepare(`SELECT * FROM "${this.tableName}" WHERE "${this.idColumn}" = ? LIMIT 1`);
            stmt.bind([id]);
            let result: T | null = null;
            if (stmt.step()) {
                result = stmt.getAsObject() as T;
            }
            stmt.free();
            return result;
        } finally {
            close();
        }
    }

    public async insert(entity: T): Promise<void> {
        const keys = Object.keys(entity);
        if (keys.length === 0) return;
        keys.forEach(k => validateIdentifier(k, 'column'));

        const { db, close, save } = await this.getDb();
        try {
            const columns = keys.map(k => `"${k}"`).join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            const values = keys.map(k => (entity as any)[k]);

            db.run(`INSERT INTO "${this.tableName}" (${columns}) VALUES (${placeholders})`, values);
            await save();
        } finally {
            close();
        }
    }

    public async update(id: string, updates: Partial<T>): Promise<void> {
        const keys = Object.keys(updates);
        if (keys.length === 0) return;
        keys.forEach(k => validateIdentifier(k, 'column'));

        const { db, close, save } = await this.getDb();
        try {
            const setClauses = keys.map(k => `"${k}" = ?`).join(', ');
            const values = [...keys.map(k => (updates as any)[k]), id];

            db.run(`UPDATE "${this.tableName}" SET ${setClauses} WHERE "${this.idColumn}" = ?`, values);
            await save();
        } finally {
            close();
        }
    }

    public async delete(id: string): Promise<void> {
        const { db, close, save } = await this.getDb();
        try {
            db.run(`DELETE FROM "${this.tableName}" WHERE "${this.idColumn}" = ?`, [id]);
            await save();
        } finally {
            close();
        }
    }

    public async count(query?: Partial<T>): Promise<number> {
        const { db, close } = await this.getDb();
        try {
            if (!query || Object.keys(query).length === 0) {
                const res = db.exec(`SELECT COUNT(*) as cnt FROM "${this.tableName}"`);
                return (res && res[0] && res[0].values[0]) ? Number(res[0].values[0][0]) : 0;
            }

            const keys = Object.keys(query);
            const clauses = keys.map(k => {
                validateIdentifier(k, 'column');
                return `"${k}" = ?`;
            });
            const values = keys.map(k => (query as any)[k]);

            const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM "${this.tableName}" WHERE ${clauses.join(' AND ')}`);
            stmt.bind(values);
            let cnt = 0;
            if (stmt.step()) {
                cnt = Number(stmt.getAsObject().cnt);
            }
            stmt.free();
            return cnt;
        } finally {
            close();
        }
    }

    public async upsert(entity: T): Promise<void> {
        const keys = Object.keys(entity);
        if (keys.length === 0) return;
        keys.forEach(k => validateIdentifier(k, 'column'));

        const { db, close, save } = await this.getDb();
        try {
            const columns = keys.map(k => `"${k}"`).join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            const values = keys.map(k => (entity as any)[k]);

            db.run(`INSERT OR REPLACE INTO "${this.tableName}" (${columns}) VALUES (${placeholders})`, values);
            await save();
        } finally {
            close();
        }
    }
}
