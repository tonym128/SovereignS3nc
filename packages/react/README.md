# sovereigns3nc/react

Official React hooks and context provider for [SovereignS3nc](https://github.com/tonym128/SovereignS3nc) — the zero-trust, offline-first, end-to-end encrypted data storage library for S3-compatible backends.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

---

## Features

- ⚛️ **Idiomatic React**: Clean, declarative hooks (`useSync`, `useFeed`, `useMessaging`, `useProfile`, `useRepository`).
- 🔄 **Reactive State**: Components automatically re-render when local storage mutates or remote sync completes.
- 📜 **Cursor-Based Keyset Pagination**: Infinite feeds and message threads powered by fast keyset pagination (`(timestamp, id)`).
- 🛡️ **Zero-Trust E2EE**: Automated asymmetric encryption using X25519 identity keys and AES-256-GCM under the hood.
- 💾 **Offline-First**: Local reads and writes take effect immediately via IndexedDB and sync in the background.

---

## Installation

The React hooks are built directly into `sovereigns3nc`:

```bash
npm install sovereigns3nc
```

> **Peer Dependencies**: Requires `react` and `react-dom` (`^18.0.0` or `^19.0.0`).

---

## Quick Start

Wrap your application tree in `<SovereignProvider>`. You can pass either a pre-configured `instance` or a declarative `config` object:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SovereignProvider } from 'sovereigns3nc/react';
import App from './App';

const sovereignConfig = {
  paths: {
    appId: 'my-social-app',
    userId: 'alice-guid',
    storeId: 'main'
  },
  password: 'user-passphrase',
  s3: {
    region: 'us-east-1',
    endpoint: 'https://s3.amazonaws.com',
    bucketName: 'my-sovereign-bucket',
    credentials: {
      accessKeyId: 'AKIA...',
      secretAccessKey: '...'
    }
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SovereignProvider config={sovereignConfig} autoInit={true}>
      <App />
    </SovereignProvider>
  </React.StrictMode>
);
```

---

## Hook API Reference

### 1. `useSovereign()`

Provides access to the underlying `SovereignS3nc` instance:

```tsx
import { useSovereign } from 'sovereigns3nc/react';

function StatusBadge() {
  const sov = useSovereign();
  const userId = sov.getConfig().paths.userId;

  return <div>Logged in as: {userId}</div>;
}
```

---

### 2. `useSync()` (or `useSyncStatus()`)

Provides reactive sync progress, stage tracking, error handling, and manual triggers:

```tsx
import { useSync } from 'sovereigns3nc/react';

function SyncButton() {
  const { isSyncing, progress, stage, error, sync } = useSync();

  return (
    <div>
      <button onClick={() => sync()} disabled={isSyncing}>
        {isSyncing ? `Syncing (${progress}% - ${stage})` : 'Sync Now'}
      </button>
      {error && <p className="error">Sync failed: {error.message}</p>}
    </div>
  );
}
```

---

### 3. `useFeed()`

Provides access to the social feed with cursor-based pagination and optimistic writes:

```tsx
import { useState } from 'react';
import { useFeed } from 'sovereigns3nc/react';

function Feed() {
  const [content, setContent] = useState('');
  const {
    posts,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    createPost,
    likePost
  } = useFeed({ limit: 20 });

  if (isLoading) return <div>Loading feed...</div>;

  return (
    <div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        await createPost(content);
        setContent('');
      }}>
        <input value={content} onChange={e => setContent(e.target.value)} />
        <button type="submit">Post</button>
      </form>

      <ul>
        {posts.map(post => (
          <li key={post.id}>
            <p>{post.content}</p>
            <button onClick={() => likePost(post.id)}>
              Like ({post.likesCount || 0})
            </button>
          </li>
        ))}
      </ul>

      {hasMore && (
        <button onClick={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? 'Loading more...' : 'Load more'}
        </button>
      )}
    </div>
  );
}
```

---

### 4. `useMessaging()` / `useDirectMessages()`

End-to-end encrypted direct messaging with automatic receipt tracking and keyset pagination:

```tsx
import { useState } from 'react';
import { useMessaging } from 'sovereigns3nc/react';

function Chat({ peerId }: { peerId: string }) {
  const [text, setText] = useState('');
  const { messages, isLoading, sendDM } = useMessaging({
    conversationWith: peerId,
    limit: 30
  });

  if (isLoading) return <div>Loading chat...</div>;

  return (
    <div>
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={msg.senderId === peerId ? 'incoming' : 'outgoing'}>
            <span>{msg.content}</span>
            <small>{msg.status}</small>
          </div>
        ))}
      </div>
      <input value={text} onChange={e => setText(e.target.value)} />
      <button onClick={async () => {
        await sendDM(peerId, text);
        setText('');
      }}>Send</button>
    </div>
  );
}
```

---

### 5. `useProfile()`

Access and update user profiles (name, bio, avatar) with automatic image compression:

```tsx
import { useProfile } from 'sovereigns3nc/react';

function UserProfile() {
  const { profile, isLoading, updateProfile } = useProfile();

  if (isLoading) return <div>Loading profile...</div>;

  return (
    <div>
      <h2>{profile?.name || 'Anonymous'}</h2>
      <p>{profile?.bio}</p>
      {profile?.avatar && <img src={profile.avatar} alt="Avatar" />}
      <button onClick={() => updateProfile('New Name', 'Updated bio')}>
        Edit Profile
      </button>
    </div>
  );
}
```

---

### 6. `useRepository<T>()`

Type-safe CRUD repository hook for custom data models:

```tsx
import { useRepository } from 'sovereigns3nc/react';

interface Note {
  id: string;
  title: string;
  body: string;
  timestamp: number;
}

function NotesApp() {
  const { data: notes, insert, remove, isLoading } = useRepository<Note>('notes_module', 'notes');

  if (isLoading) return <div>Loading notes...</div>;

  return (
    <div>
      <button onClick={() => insert({
        id: crypto.randomUUID(),
        title: 'New Note',
        body: 'Hello World',
        timestamp: Date.now()
      })}>
        Add Note
      </button>
      <ul>
        {notes.map(note => (
          <li key={note.id}>
            <h3>{note.title}</h3>
            <p>{note.body}</p>
            <button onClick={() => remove(note.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## License

ISC © [Tony Mobily](https://github.com/tonym128)
