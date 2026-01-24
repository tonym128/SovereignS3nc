import { SovereignS3nc } from '../src/SovereignS3nc';

describe('SovereignS3nc Collection Isolation', () => {
  let db: SovereignS3nc;

  beforeEach(async () => {
    db = new SovereignS3nc({
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
      encryptionKey: 'master-key-000000000000000000000000'
    });
    await db.init();
  });

  test('should isolate documents between collections', async () => {
    await db.collection('posts').save({ title: 'Post 1' });
    await db.collection('tasks').save({ title: 'Task 1' });
    await db.save({ title: 'Root Doc' }); // Default collection (undefined)

    const posts = await db.collection('posts').getAll();
    const tasks = await db.collection('tasks').getAll();
    const root = await db.getAll(); // Returns everything

    expect(posts).toHaveLength(1);
    expect((posts[0] as any).title).toBe('Post 1');

    expect(tasks).toHaveLength(1);
    expect((tasks[0] as any).title).toBe('Task 1');

    // db.getAll() returns everything in the database (global view)
    expect(root).toHaveLength(3); 
    
    // Verify root doc is in there
    expect(root.find((d: any) => d.title === 'Root Doc')).toBeDefined();
  });

  test('get should only return doc if in correct collection', async () => {
    const id = await db.collection('posts').save({ title: 'Secret' });
    
    const fromPosts = await db.collection('posts').get(id);
    expect(fromPosts).toBeDefined();

    const fromTasks = await db.collection('tasks').get(id);
    expect(fromTasks).toBeNull();
  });
});
