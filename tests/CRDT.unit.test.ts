import {
    VectorClock,
    LWWRegister,
    CRDTRow,
    ORSet,
    CRDTBinaryBridge
} from '../src/core/crdt';

interface Task {
    title: string;
    column: string;
    priority: string;
    assignee?: string;
}

describe('CRDT Integration & Primitives (Item 17)', () => {
    describe('VectorClock', () => {
        it('tracks increments and compares causality', () => {
            const clockA = new VectorClock();
            const clockB = new VectorClock();

            clockA.increment('peer1');
            clockB.increment('peer2');

            // Concurrency
            expect(clockA.compare(clockB)).toBe('concurrent');
            expect(clockB.compare(clockA)).toBe('concurrent');

            // Merge clockB into clockA
            clockA.merge(clockB);
            expect(clockA.get('peer1')).toBe(1);
            expect(clockA.get('peer2')).toBe(1);

            // Now clockA is causally after clockB
            expect(clockA.compare(clockB)).toBe('after');
            expect(clockB.compare(clockA)).toBe('before');

            // Equality
            const clockC = VectorClock.fromJSON(clockA.toJSON());
            expect(clockA.compare(clockC)).toBe('equal');
        });
    });

    describe('LWWRegister', () => {
        it('applies latest timestamp and uses deterministic tie-breaking for ties', () => {
            const regA = new LWWRegister('value1', 'alice', 100);
            expect(regA.value).toBe('value1');

            // Older timestamp is rejected
            const updatedOlder = regA.merge(new LWWRegister('value0', 'bob', 90));
            expect(updatedOlder).toBe(false);
            expect(regA.value).toBe('value1');

            // Newer timestamp is accepted
            const updatedNewer = regA.merge(new LWWRegister('value2', 'bob', 110));
            expect(updatedNewer).toBe(true);
            expect(regA.value).toBe('value2');

            // Equal timestamp: tie-break by peerId ('charlie' > 'bob')
            const tieBreak = regA.merge(new LWWRegister('valueTie', 'charlie', 110));
            expect(tieBreak).toBe(true);
            expect(regA.value).toBe('valueTie');

            // Equal timestamp with lower peerId ('alex' < 'charlie') is rejected
            const tieBreakRejected = regA.merge(new LWWRegister('valueLower', 'alex', 110));
            expect(tieBreakRejected).toBe(false);
            expect(regA.value).toBe('valueTie');
        });

        it('serializes and deserializes cleanly', () => {
            const reg = new LWWRegister(42, 'device-1', 123456);
            const json = JSON.stringify(reg.toJSON());
            const restored = LWWRegister.fromJSON<number>(json);
            expect(restored.value).toBe(42);
            expect(restored.peerId).toBe('device-1');
            expect(restored.timestamp).toBe(123456);
        });
    });

    describe('CRDTRow (Field-Level LWW Register)', () => {
        it('handles non-conflicting concurrent edits on different fields without data loss', () => {
            // Initial task created at t=100
            const initialTask: Task = {
                title: 'Refactor Auth',
                column: 'Todo',
                priority: 'low'
            };

            const deviceA = new CRDTRow<Task>(initialTask, 'device-a', 100);
            const deviceB = CRDTRow.fromJSON<Task>(deviceA.toJSONString(), 'device-b');

            // Device A moves column to 'In Progress' at t=150
            deviceA.set('column', 'In Progress', 150);

            // Device B updates title to 'Refactor Auth and Sessions' and priority to 'high' at t=160
            deviceB.set('title', 'Refactor Auth and Sessions', 160);
            deviceB.set('priority', 'high', 160);

            // Both devices merge each other's changes
            const changedOnA = deviceA.merge(deviceB);
            const changedOnB = deviceB.merge(deviceA);

            expect(changedOnA).toBe(true);
            expect(changedOnB).toBe(true);

            // Both devices have converged to identical state
            expect(deviceA.toObject()).toEqual(deviceB.toObject());
            expect(deviceA.toObject()).toEqual({
                title: 'Refactor Auth and Sessions',
                column: 'In Progress',
                priority: 'high'
            });
        });

        it('resolves conflicting edits on the same field deterministically', () => {
            const row1 = new CRDTRow<Task>({ column: 'Todo' }, 'peer-1', 100);
            const row2 = new CRDTRow<Task>({ column: 'Todo' }, 'peer-2', 100);

            // Concurrent edits at the same timestamp
            row1.set('column', 'In Progress', 200, 'peer-1');
            row2.set('column', 'Done', 200, 'peer-2');

            row1.merge(row2);
            row2.merge(row1);

            // peer-2 > peer-1, so 'Done' wins deterministically on both sides
            expect(row1.get('column')).toBe('Done');
            expect(row2.get('column')).toBe('Done');
        });

        it('provides backwards-compatible top-level properties and handles legacy JSON', () => {
            const row = new CRDTRow({ title: 'Task 1', column: 'Done' }, 'device-1');
            const serialized = row.toJSON();

            // Direct top-level access works for plain consumers
            expect(serialized.title).toBe('Task 1');
            expect(serialized.column).toBe('Done');
            expect(serialized._crdt).toBeDefined();

            // Merging legacy plain JSON without _crdt
            const legacyRow = { title: 'Legacy Task', column: 'Todo' };
            const merged = row.merge(legacyRow as any);
            expect(merged).toBe(true);
            expect(row.get('title')).toBe('Legacy Task');
        });
    });

    describe('ORSet (Observed-Remove Set)', () => {
        it('supports concurrent adds and removes', () => {
            const setA = new ORSet<string>('peer-a');
            const setB = new ORSet<string>('peer-b');

            const tag1 = setA.add('Item 1');
            const tag2 = setA.add('Item 2');

            // Sync setA into setB
            setB.merge(setA);
            expect(setB.values()).toEqual(expect.arrayContaining(['Item 1', 'Item 2']));

            // setA removes Item 1
            setA.remove('Item 1');
            expect(setA.has('Item 1')).toBe(false);

            // setB adds Item 3
            setB.add('Item 3');

            // Merge back
            setA.merge(setB);
            setB.merge(setA);

            expect(setA.values().sort()).toEqual(['Item 2', 'Item 3']);
            expect(setB.values().sort()).toEqual(['Item 2', 'Item 3']);
        });
    });

    describe('AutomergeYjsBridge', () => {
        it('serializes and extracts binary payloads for Automerge/Yjs', () => {
            const fakeUpdate = new Uint8Array([0, 1, 2, 3, 255, 128, 64]);
            const payload = CRDTBinaryBridge.createPayload('doc-kanban-1', 'yjs', fakeUpdate, 'user-123');

            expect(payload.docId).toBe('doc-kanban-1');
            expect(payload.engine).toBe('yjs');
            expect(typeof payload.updateBase64).toBe('string');

            const restored = CRDTBinaryBridge.extractUpdate(payload);
            expect(restored).toEqual(fakeUpdate);

            // Also parses JSON string
            const jsonString = JSON.stringify(payload);
            const restoredFromJson = CRDTBinaryBridge.extractUpdate(jsonString);
            expect(restoredFromJson).toEqual(fakeUpdate);
        });
    });
});
