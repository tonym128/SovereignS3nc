import { SovereignS3nc } from '../src/SovereignS3nc';

describe('SovereignS3nc Application Primitives', () => {
  let db: SovereignS3nc;

  beforeEach(async () => {
    db = new SovereignS3nc({
      paths: { appId: 'app', userId: 'me', storeId: 'store' },
      encryptionKey: 'master-key-000000000000000000000000'
    });
    await db.init();
  });

  test('should handle social feed and comments', async () => {
    const postId = await db.collection('posts').save({ text: 'Hello World', authorId: 'me', createdAt: Date.now() });
    await db.collection('comments').save({ postId, text: 'Nice post!', authorId: 'friend', createdAt: Date.now() });

    const feed = await db.social.getFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toBe('Hello World');

    const comments = await db.social.getComments(postId);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe('Nice post!');
  });

  test('should handle boards and tasks', async () => {
    const taskId = await db.boards.addTask({ 
        title: 'Fix Bug', 
        status: 'todo', 
        order: 1 
    }, 'engineering');

    let tasks = await db.boards.getTasks('engineering');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Fix Bug');

    await db.boards.moveTask(taskId, 'done', 0, 'engineering');
    tasks = await db.boards.getTasks('engineering');
    expect(tasks[0].status).toBe('done');
  });
});
