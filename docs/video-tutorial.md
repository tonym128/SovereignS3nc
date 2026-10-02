# 3-Minute Video Guide: Build an E2EE Offline-First App with SovereignS3nc

Welcome to the 3-minute video walkthrough for **SovereignS3nc**! This page includes the full video screencast, interactive video player, and complete scene-by-scene production script and code walkthrough.

---

## 🎥 Video Screencast & Player

<div style="max-width: 100%; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.25); margin: 2rem 0; background: #0a0d13;">
  <video 
    controls 
    playsinline 
    preload="metadata" 
    poster="/videos/poster.png" 
    style="width: 100%; display: block; max-height: 540px; border-radius: 12px;">
    <source src="/videos/sovereigns3nc-quickstart.mp4" type="video/mp4">
    Your browser does not support the video tag.
  </video>
</div>

> 💡 **Prefer reading?** Below is the exact minute-by-minute transcript, storyboard, visual cues, and runnable code shown in the video.

---

## ⏱️ Minute-by-Minute Video Storyboard & Script

### 🎬 Scene 1: The Centralized Trap vs. Zero-Knowledge S3 (0:00 – 0:40)

- **Visual**: Animated diagram showing centralized cloud databases (Supabase/Firebase) with servers reading plaintext, followed by a cross-mark showing connection failure when offline. Transitions to the SovereignS3nc architecture diagram: client-side SQLite + X25519 encryption + commodity S3 storage.
- **Narration**:
  > *"When building modern web and mobile applications, we’re often told to rely on centralized backend-as-a-service platforms like Supabase or Firebase. But what happens when the network drops? Your app freezes. What happens when your database server gets hacked? All your users' unencrypted data leaks.*
  >
  > *Meet **SovereignS3nc**: a zero-server, offline-first storage library. Every byte of data is stored in a local, relational SQLite database inside your browser, encrypted with modern X25519 and AES-256-GCM cryptography, and synchronized directly with any standard S3 bucket or via peer-to-peer WebRTC. Zero application servers. Zero unencrypted data on the cloud. 100% offline resilience."*

---

### 🎬 Scene 2: Live Code: 60-Second Reactive Notes App (0:40 – 1:40)

- **Visual**: Split screen in VS Code. Terminal runs `npm install sovereigns3nc`. The developer creates an `App.tsx` file using the React provider and `useRepository` hook.
- **Narration**:
  > *"Let's build a fully syncing, encrypted notes application in under 60 seconds.*
  >
  > *First, we install `sovereigns3nc`. We wrap our application with `<SovereignProvider>`, specifying our user credentials and S3 endpoint. Now, we use the `useRepository` hook to read and write notes directly into local SQLite."*

```tsx
import React, { useState } from 'react';
import { SovereignProvider, useRepository } from 'sovereigns3nc/react';

interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

function NotesList() {
  const { data: notes, loading, create, update, remove } = useRepository<Note>('notes');
  const [text, setText] = useState('');

  const handleAdd = async () => {
    if (!text.trim()) return;
    await create({
      id: 'note-' + Date.now(),
      title: text,
      body: text,
      updatedAt: Date.now()
    });
    setText('');
  };

  return (
    <div className="notes-container">
      <h2>🔒 Encrypted Offline Notes</h2>
      <input 
        value={text} 
        onChange={(e) => setText(e.target.value)} 
        placeholder="Type a secure note..." 
      />
      <button onClick={handleAdd}>Add Note</button>

      {loading ? <p>Loading SQLite...</p> : (
        <ul>
          {notes.map(n => <li key={n.id}>{n.title}</li>)}
        </ul>
      )}
    </div>
  );
}

export function App() {
  return (
    <SovereignProvider config={{
      appId: 'my-notes-app',
      userId: 'alice',
      password: 'super-secure-passphrase',
      s3: {
        endpoint: 'https://s3.us-east-1.amazonaws.com',
        bucketName: 'my-private-notes-vault'
      }
    }}>
      <NotesList />
    </SovereignProvider>
  );
}
```

- **Narration**:
  > *"Every time `create()` is called, our note is instantly saved to local IndexedDB and committed to our daily SQLite partition in microseconds. No waiting for server round-trips."*

---

### 🎬 Scene 3: Airplane Mode & Multi-Device Sync (1:40 – 2:30)

- **Visual**: Developer opens Chrome DevTools, toggles **Offline (Airplane Mode)**, and types three new notes. The UI updates instantly with zero latency. The developer then turns the network back on: the background Web Worker detects connectivity, computes the Merkle-tree diff, and uploads the encrypted daily database delta to S3. Simultaneously, a second browser window (logged in as the same user) automatically updates.
- **Narration**:
  > *"Let's test offline mode. We turn off Wi-Fi in DevTools. We add notes, modify existing ones, and reorder them. The app responds instantly because everything runs against local SQLite WebAssembly.*
  >
  > *Now, we re-enable network connectivity. In the background, SovereignS3nc's Worker engine wakes up, generates an incremental Merkle manifest, and pushes only the changed partitions to S3. Opening the S3 console reveals what the cloud provider sees: salted private GUIDs and pure AES-256-GCM ciphertext. The storage provider knows nothing about your notes."*

---

### 🎬 Scene 4: Conclusion & Getting Started (2:30 – 3:00)

- **Visual**: Showcase of the live interactive sandbox demos (Social, Kanban Board, Personal Banking, Blog). Links appear on screen for docs, npm package, and GitHub repo.
- **Narration**:
  > *"SovereignS3nc gives you the simplicity of serverless object storage, the speed of local SQLite, and the security of zero-trust end-to-end encryption.*
  >
  > *Try out our five live demo apps—including full Kanban boards, encrypted feeds, and multi-user messaging—right now in your browser. Install `sovereigns3nc` today from npm and check out the documentation at the link below. Take control of your users' data sovereignty!"*

---

## 🚀 Next Steps

- 📦 [Install npm package](https://www.npmjs.com/package/sovereigns3nc)
- 📖 [React Hooks Guide](/react)
- ⚖️ [How SovereignS3nc Compares to Supabase, Firebase & PocketBase](/comparison)
- 🕹️ [Try the Live Interactive Demos](https://tonym128.github.io/SovereignS3nc/)
