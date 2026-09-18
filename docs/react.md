# React Hooks (`@sovereigns3nc/react`)

The `@sovereigns3nc/react` package provides official idiomatic React 19 hooks and context providers for SovereignS3nc.

---

## 📦 Installation

```bash
npm install sovereigns3nc @sovereigns3nc/react
```

---

## 🚀 Quick Setup: `<SovereignProvider>`

Wrap your application root with `<SovereignProvider>`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SovereignProvider } from '@sovereigns3nc/react';
import { App } from './App';

const config = {
  paths: {
    appId: 'my-social-app',
    userId: 'alice',
    storeId: 'main'
  },
  password: 'user-password-123',
  s3: {
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'AWS_KEY',
      secretAccessKey: 'AWS_SECRET'
    },
    bucketName: 'sovereign-storage'
  },
  useWorker: true
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <SovereignProvider config={config}>
    <App />
  </SovereignProvider>
);
```

---

## 🎣 Available Hooks

### 1. `useSovereign()`
Access the underlying `SovereignS3nc` instance directly.

```tsx
import { useSovereign } from '@sovereigns3nc/react';

function UserProfile() {
  const sov = useSovereign();
  const userId = sov.getConfig().paths.userId;

  return <div>Logged in as: {userId}</div>;
}
```

---

### 2. `useSyncStatus()`
Track active synchronization state, progress, and trigger manual syncs.

```tsx
import { useSyncStatus } from '@sovereigns3nc/react';

function SyncBadge() {
  const { isSyncing, progress, stage, error, sync } = useSyncStatus();

  return (
    <div>
      <button onClick={() => sync()} disabled={isSyncing}>
        {isSyncing ? `Syncing (${stage}: ${progress}%)...` : 'Sync Now'}
      </button>
      {error && <span className="text-danger">{error.message}</span>}
    </div>
  );
}
```

---

### 3. `useRepository<T>(repoName)`
Type-safe, reactive key-value document store with automated change notifications.

```tsx
import { useRepository } from '@sovereigns3nc/react';

interface Task {
  id: string;
  title: string;
  done: boolean;
}

function TaskList() {
  const { data: tasks, set, remove, isLoading } = useRepository<Task>('tasks');

  const toggleTask = (task: Task) => {
    set(task.id, { ...task, done: !task.done });
  };

  if (isLoading) return <div>Loading tasks...</div>;

  return (
    <ul>
      {tasks.map(task => (
        <li key={task.id} onClick={() => toggleTask(task)}>
          {task.done ? '✅' : '⬜'} {task.title}
        </li>
      ))}
    </ul>
  );
}
```

---

### 4. `useDirectMessages(recipientId)`
End-to-end encrypted direct messaging with asymmetric X25519 key exchange.

```tsx
import React, { useState } from 'react';
import { useDirectMessages } from '@sovereigns3nc/react';

function ChatBox({ friendId }: { friendId: string }) {
  const { messages, sendDM, isLoading } = useDirectMessages(friendId);
  const [text, setText] = useState('');

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await sendDM(text);
    setText('');
  };

  return (
    <div>
      <div className="chat-window">
        {messages.map(m => (
          <div key={m.id} className={m.senderId === friendId ? 'received' : 'sent'}>
            {m.content}
          </div>
        ))}
      </div>
      <form onSubmit={handleSend}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Type encrypted message..." />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}
```

---

### 5. `useFeed()`
Public social posting with comments and reactions.

```tsx
import React, { useState } from 'react';
import { useFeed } from '@sovereigns3nc/react';

function Feed() {
  const { posts, createPost, likePost, isLoading } = useFeed();
  const [content, setContent] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    await createPost(content);
    setContent('');
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea value={content} onChange={e => setContent(e.target.value)} />
        <button type="submit">Post to Feed</button>
      </form>

      {posts.map(post => (
        <div key={post.id} className="post">
          <p>{post.content}</p>
          <button onClick={() => likePost(post.id)}>❤️ {post.likes || 0}</button>
        </div>
      ))}
    </div>
  );
}
```
