import { SovereignS3nc, ModuleDefinition, Logger } from '../../../src';

export interface Todo {
    id: string;
    task: string;
    completed: boolean;
    timestamp: number;
}

export const TODO_MODULE_DEFINITION: ModuleDefinition = {
    name: 'todo',
    tables: [
        {
            name: 'todos',
            schema: `
                id TEXT PRIMARY KEY,
                task TEXT,
                completed INTEGER DEFAULT 0,
                timestamp INTEGER
            `
        }
    ],
    migrations: []
};

export class TodoModule {
    private readonly MODULE_NAME = 'todo';
    private sqliteInstance: any = null;

    constructor(private sov: SovereignS3nc) {
        // 1. Register the module
        this.sov.registerModule(TODO_MODULE_DEFINITION);
    }

    private async getDb(): Promise<any> {
        // 2. Use a namespaced path in private storage
        const dbPath = `private/modules/${this.MODULE_NAME}/todos.db`;
        const data = await this.sov.getStorage().getFile(dbPath);

        const initSqlJs = (globalThis as any).initSqlJs;
        if (!initSqlJs) {
            throw new Error('sql.js not found. Ensure it is loaded in the environment.');
        }

        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        }
        
        const db = new this.sqliteInstance.Database(data || undefined);

        // 3. Ensure tables and migrations are applied
        this.sov.applyModuleSchema(db, this.MODULE_NAME);

        return db;
    }

    private async saveDb(db: any) {
        const dbPath = `private/modules/${this.MODULE_NAME}/todos.db`;
        const binary = db.export();
        
        // 4. Save back to storage
        await this.sov.getStorage().saveFile(dbPath, binary);
        db.close();
        
        // 5. Trigger sync and update events
        this.sov.onModuleUpdate(this.MODULE_NAME, dbPath);
    }

    async addTodo(task: string): Promise<Todo> {
        const db = await this.getDb();
        
        const todo: Todo = {
            id: Math.random().toString(36).substring(7),
            task,
            completed: false,
            timestamp: Date.now()
        };

        db.run('INSERT INTO todos (id, task, completed, timestamp) VALUES (?, ?, ?, ?)',
            [todo.id, todo.task, todo.completed ? 1 : 0, todo.timestamp]);

        await this.saveDb(db);
        return todo;
    }

    async getTodos(): Promise<Todo[]> {
        const db = await this.getDb();
        const res = db.exec('SELECT * FROM todos ORDER BY timestamp DESC');
        const todos: Todo[] = [];
        
        if (res.length > 0) {
            const cols = res[0].columns;
            res[0].values.forEach((row: any) => {
                const todo: any = {};
                cols.forEach((c: string, i: number) => {
                    let val = row[i];
                    if (c === 'completed') val = !!val;
                    todo[c] = val;
                });
                todos.push(todo);
            });
        }
        
        db.close();
        return todos;
    }

    async toggleTodo(id: string) {
        const db = await this.getDb();
        db.run('UPDATE todos SET completed = NOT completed WHERE id = ?', [id]);
        await this.saveDb(db);
    }

    async deleteTodo(id: string) {
        const db = await this.getDb();
        db.run('DELETE FROM todos WHERE id = ?', [id]);
        await this.saveDb(db);
    }
}
