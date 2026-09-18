---
layout: home

hero:
  name: SovereignS3nc
  text: Offline-First, End-to-End Encrypted Data Engine
  tagline: True data sovereignty for modern web applications. Syncs with S3 object storage and WebRTC peer meshes with zero backend servers.
  actions:
    - theme: brand
      text: Quick Start Guide
      link: /module-tutorial
    - theme: alt
      text: Why SovereignS3nc?
      link: /comparison
    - theme: alt
      text: Interactive Demos
      link: https://tonym128.github.io/SovereignS3nc/

features:
  - title: 🔒 Zero-Knowledge Cryptography
    details: Asymmetric X25519 identity keys combined with AES-256-GCM. Remote S3 buckets only ever hold ciphertext; private GUIDs prevent identity correlation.
  - title: ⚡ Offline-First Architecture
    details: Instant local reads and writes via browser IndexedDB. Sync operations occur asynchronously in background Web Workers without freezing the UI.
  - title: 🌐 Hybrid S3 & WebRTC Mesh
    details: Sync seamlessly with any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, RustFS) or peer-to-peer over serverless WebRTC data channels.
  - title: 🗄️ In-Browser SQLite WASM
    details: Run full relational SQL engines in the browser via WebAssembly. Features transaction compaction and hierarchical Merkle tree diffing.
  - title: 🧩 Pluggable Module System
    details: Build specialized domain modules (Feeds, Messaging, Profiles, Ledgers) with auto-namespaced paths and reactive sync hooks.
  - title: ⚛️ Official React Package
    details: First-class reactive integration with @sovereigns3nc/react — `<SovereignProvider>`, `useSovereign`, `useSyncStatus`, and `useRepository`.
---

## ⚡ 60-Second Quickstart

Install the core engine and optional React bindings:

```bash
npm install sovereigns3nc
# or with React:
npm install sovereigns3nc @sovereigns3nc/react
```

### Initialize and Store Encrypted Data

```typescript
import { SovereignS3nc } from 'sovereigns3nc';

// 1. Create a sovereign client instance
const sov = await SovereignS3nc.create({
  paths: {
    appId: 'my-app',
    userId: 'alice-123',
    storeId: 'main'
  },
  password: 'user-master-password',
  s3: {
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    },
    bucketName: 'my-sovereign-bucket'
  },
  useWorker: true
});

// 2. Write data locally (instantly persisted to IndexedDB)
await sov.getStorage().saveFile(
  'private/notes/secret.txt',
  new TextEncoder().encode('Decentralized and encrypted!')
);

// 3. Two-way sync to S3 with Merkle diffing
await sov.sync();
console.log('Synchronized successfully!');
```

### Using Reactive React Hooks

```tsx
import React from 'react';
import { SovereignProvider, useSyncStatus, useRepository } from '@sovereigns3nc/react';

interface Note {
  id: string;
  title: string;
  body: string;
}

function NotesApp() {
  const { isSyncing, sync } = useSyncStatus();
  const { data: notes, set: saveNote } = useRepository<Note>('notes');

  return (
    <div>
      <button onClick={() => sync()} disabled={isSyncing}>
        {isSyncing ? 'Syncing...' : 'Sync Now'}
      </button>

      <ul>
        {notes.map(note => (
          <li key={note.id}><strong>{note.title}</strong>: {note.body}</li>
        ))}
      </ul>
    </div>
  );
}
```
