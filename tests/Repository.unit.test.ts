import { SovereignS3nc } from '../src/SovereignS3nc';
import { Repository } from '../src/core/Repository';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { RepositoryError } from '../src/utils/Errors';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';
import initSqlJs from 'sql.js';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    async uploadFile(): Promise<string | null> { return '"etag"'; }
    async downloadFile(): Promise<any | null> { return null; }
    async getFileHash(): Promise<string | null> { return null; }
    async getFileEtag(): Promise<string | null> { return null; }
    async canWrite(): Promise<boolean> { return true; }
}

interface NoteEntity {
    id: string;
    title: string;
    content: string;
    priority: number;
    isDone?: number;
    createdAt?: number;
}

describe('Lightweight Typed Repository Layer (getRepository<T>)', () => {
    let sov: SovereignS3nc;
    const testDate = '2026-09-18';

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        const testId = Math.random().toString(36).substring(7);
        const config = {
            paths: { appId: `repo-test-${testId}`, userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };

        sov = new SovereignS3nc(config, new MockRemote());
        await sov.init();

        // Register custom module with notes table schema
        sov.registerModule({
            name: 'notes',
            tables: [
                {
                    name: 'notes',
                    schema: `
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        content TEXT,
                        priority INTEGER DEFAULT 1,
                        isDone INTEGER DEFAULT 0,
                        createdAt INTEGER
                    `
                }
            ]
        });
    });

    test('Full Type-Safe CRUD operations: insert, findById, find, update, count, delete', async () => {
        const repo: Repository<NoteEntity> = sov.getRepository<NoteEntity>('notes', 'notes', testDate, 'public');

        // 1. Insert records
        await repo.insert({
            id: 'n1',
            title: 'First Note',
            content: 'Hello SovereignS3nc',
            priority: 1,
            isDone: 0,
            createdAt: 1000
        });

        await repo.insert({
            id: 'n2',
            title: 'Second Note',
            content: 'Typed repository is fast',
            priority: 2,
            isDone: 0,
            createdAt: 2000
        });

        await repo.insert({
            id: 'n3',
            title: 'Done Note',
            content: 'Completed task',
            priority: 1,
            isDone: 1,
            createdAt: 3000
        });

        // 2. findById
        const found = await repo.findById('n1');
        expect(found).not.toBeNull();
        expect(found?.id).toBe('n1');
        expect(found?.title).toBe('First Note');
        expect(found?.content).toBe('Hello SovereignS3nc');

        const notFound = await repo.findById('non-existent');
        expect(notFound).toBeNull();

        // 3. find all and find by query
        const allNotes = await repo.find();
        expect(allNotes.length).toBe(3);

        const priority1Notes = await repo.find({ priority: 1 });
        expect(priority1Notes.length).toBe(2);
        expect(priority1Notes.map(n => n.id)).toEqual(expect.arrayContaining(['n1', 'n3']));

        const doneNotes = await repo.find({ isDone: 1 });
        expect(doneNotes.length).toBe(1);
        expect(doneNotes[0].id).toBe('n3');

        // 4. count
        const totalCount = await repo.count();
        expect(totalCount).toBe(3);

        const doneCount = await repo.count({ isDone: 1 });
        expect(doneCount).toBe(1);

        // 5. update
        await repo.update('n1', { title: 'Updated First Note', isDone: 1 });
        const updated = await repo.findById('n1');
        expect(updated?.title).toBe('Updated First Note');
        expect(updated?.isDone).toBe(1);
        // Untouched fields remain intact
        expect(updated?.content).toBe('Hello SovereignS3nc');

        // 6. delete
        await repo.delete('n2');
        const afterDelete = await repo.find();
        expect(afterDelete.length).toBe(2);
        expect(await repo.findById('n2')).toBeNull();
    });

    test('upsert creates new entity or updates existing entity', async () => {
        const repo: Repository<NoteEntity> = sov.getRepository<NoteEntity>('notes', 'notes', testDate, 'public');

        await repo.upsert({
            id: 'u1',
            title: 'Initial Title',
            content: 'Body 1',
            priority: 3
        });

        let item = await repo.findById('u1');
        expect(item?.title).toBe('Initial Title');

        // Upsert same ID
        await repo.upsert({
            id: 'u1',
            title: 'Replaced Title',
            content: 'Body 2',
            priority: 5
        });

        item = await repo.findById('u1');
        expect(item?.title).toBe('Replaced Title');
        expect(item?.priority).toBe(5);
        expect(await repo.count()).toBe(1);
    });

    test('SQL Injection Protection: rejects malicious table names and column names', async () => {
        // Malicious table names
        expect(() => {
            sov.getRepository('notes', 'notes; DROP TABLE users; --');
        }).toThrow(RepositoryError);

        expect(() => {
            sov.getRepository('notes', 'notes WHERE 1=1');
        }).toThrow(RepositoryError);

        expect(() => {
            sov.getRepository('notes', 'notes" OR ""="');
        }).toThrow(RepositoryError);

        const validRepo = sov.getRepository<NoteEntity>('notes', 'notes', testDate);

        // Malicious column names in find()
        await expect(validRepo.find({ "title; DROP TABLE notes; --": "test" } as any))
            .rejects.toThrow(RepositoryError);

        await expect(validRepo.find({ "id' OR '1'='1": "test" } as any))
            .rejects.toThrow(RepositoryError);

        // Malicious column names in insert()
        await expect(validRepo.insert({ "id": "evil", "title', ''); DROP TABLE notes; --": "val" } as any))
            .rejects.toThrow(RepositoryError);

        // Malicious column names in update()
        await expect(validRepo.update('n1', { "content = 'hacked', id": "hack" } as any))
            .rejects.toThrow(RepositoryError);
    });

    test('SQL Injection Protection: safely parameterizes attack strings in values', async () => {
        const repo: Repository<NoteEntity> = sov.getRepository<NoteEntity>('notes', 'notes', testDate, 'public');

        const injectionPayload = "'; DROP TABLE notes; SELECT * FROM notes WHERE '1'='1";

        // Insert entity with attack payload as text value
        await repo.insert({
            id: 'safe-1',
            title: injectionPayload,
            content: "another attack: ' OR '1'='1",
            priority: 1
        });

        // Entity is safely stored verbatim without executing SQL commands
        const retrieved = await repo.findById('safe-1');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.title).toBe(injectionPayload);

        // Querying by the injection payload matches only exact string
        const found = await repo.find({ title: injectionPayload });
        expect(found.length).toBe(1);
        expect(found[0].id).toBe('safe-1');

        // Table is fully intact
        expect(await repo.count()).toBe(1);
    });

    test('Emits module update event on write operations', async () => {
        const repo: Repository<NoteEntity> = sov.getRepository<NoteEntity>('notes', 'notes', testDate, 'public');
        let updateCount = 0;
        sov.on('notes:update', () => {
            updateCount++;
        });

        await repo.insert({ id: 'evt-1', title: 'Note 1', content: 'C1', priority: 1 });
        await repo.update('evt-1', { title: 'Updated' });
        await repo.delete('evt-1');

        expect(updateCount).toBe(3);
    });
});
