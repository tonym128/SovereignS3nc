# SovereignS3nc

A generic, offline-first data storage library that syncs with any S3-compatible object storage (AWS S3, Oracle OCI Object Storage, Garage, MinIO, etc.).

## Features

- **Offline-First**: Reads and writes to local storage (in-memory, file-based, or IndexedDB).
- **S3 Sync**: Automatically syncs changes to an S3 bucket or OCI PAR.
- **End-to-End Encryption**: Client-side AES-256-GCM encryption. Keys never leave the client.
- **Social & Sharing**: Built-in support for public profiles, following users, and sharing content.
- **Blob Storage**: specialized adapter for handling large binary assets (images, attachments).
- **Conflict Resolution**: Last-Write-Wins (LWW) or Deep Merge.
- **Pluggable**: Adapters for storage, remote communication, and cryptography.

## Installation

```bash
npm install sovereigns3nc
```

## Usage

### 1. Initialize

SovereignS3nc supports both AWS S3 (via credentials) and Oracle OCI (via Pre-Authenticated Requests).

```typescript
import { SovereignS3nc, IndexedDBStorage } from 'sovereigns3nc';

const db = new SovereignS3nc({
  // Option A: Standard S3 (AWS, MinIO, Garage)
  s3: {
    region: 'us-east-1',
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    bucketName: 'my-app-data',
    credentials: {
      accessKeyId: 'YOUR_ACCESS_KEY',
      secretAccessKey: 'YOUR_SECRET_KEY'
    }
  },
  
  // Option B: OCI Pre-Authenticated Request (No credentials needed)
  // ociParUrl: 'https://objectstorage.us-phoenix-1.oraclecloud.com/p/...',

  paths: {
    appId: 'my-social-app',
    userId: 'user-guid-123', // Unique User ID
    storeId: 'default'
  },
  
  // Security & Encryption
  auth: {
    privatePassphrase: 'my-secret-password', // Derives encryption key for private data
    publicPassphrase: 'my-public-password'    // Derives key for public identity/index
  },

  syncIntervalMs: 5000, // Auto-sync every 5 seconds
}, new IndexedDBStorage('MyAppDB'));

await db.init();
```

### 2. Core Operations

The core API handles JSON documents.

```typescript
// Save a document (Encryption handled automatically)
const id = await db.save({
  title: 'My Note',
  content: 'Hello World',
  tags: ['personal']
}, 'notes'); // Collection name

// Get a document
const doc = await db.get(id, 'notes');
console.log(doc);

// Delete
await db.delete(id, 'notes');

// List all in a collection
const notes = await db.collection('notes').getAll();
```

### 3. Modules

SovereignS3nc includes specialized modules for common patterns.

#### Social Manager (`db.social`)
Handles user profiles, following, and feeds.

```typescript
// Create/Update Profile
await db.profile.update({
    displayName: 'Alice',
    bio: 'Crypto enthusiast'
});

// Follow a user
await db.social.follow({
    userId: 'bob-guid-456',
    appId: 'my-social-app',
    bucket: 'bobs-bucket', // If different
    region: 'us-east-1'
});

// Get Feed (Aggregated from followed users)
const feed = await db.social.getFeed();
```

#### Blob Storage (`db.storage`)
Handles binary files like images.

```typescript
// Upload (automatically encrypted unless isPublic=true)
const fileData = await fileInput.files[0].arrayBuffer();
const meta = await db.storage.upload(
    'avatar.jpg', 
    new Uint8Array(fileData), 
    'image/jpeg', 
    true // isPublic
);

console.log('Blob ID:', meta._id);

// Download
const data = await db.storage.download(meta._id);
```

#### Board Manager (`db.boards`)
Kanban-style board management.

```typescript
const boardId = await db.boards.createBoard('Project Alpha');
await db.boards.addColumn(boardId, 'To Do');
await db.boards.addCard(boardId, columnId, 'Setup Repo');
```

### 4. Sync & Sharing

#### Synchronization
Sync handles pushing local changes and pulling remote updates (including content from followed users).

```typescript
// Force sync
const stats = await db.sync();
console.log(`Synced: ${stats.pushed} pushed, ${stats.pulled} pulled`);

// Listen for events
db.on('syncComplete', (stats) => updateUI(stats));
```

#### Public Sharing
Share specific documents with the world.

```typescript
// Share a document publicly
// Generates a unique key, encrypts the doc with it, and publishes metadata to 'shared/public/'
const shareId = await db.share(docId, true, 'posts');

// Unshare
await db.unshare(docId);
```

## Demos

The project includes several demos in the `demo/` folder showcasing different capabilities.

### Prerequisites
- Node.js 16+
- An S3-compatible bucket (AWS, MinIO, Garage, OCI)

### Running Demos

1. **Build the project:**
   ```bash
   npm install
   npm run build
   ```

2. **Serve the demos:**
   You can use any static file server.
   ```bash
   npx http-server .
   ```

3. **Open a demo:**
   Navigate to the demo folder in your browser:
   - **Social App**: `http://127.0.0.1:8080/demo/social/`
     - *Features*: Profiles, Posting with images, Comments, Follow users (Federation), OCI/S3 support.
   - **Notes App**: `http://127.0.0.1:8080/demo/notes/`
   - **Chat App**: `http://127.0.0.1:8080/demo/chat/`

### Demo Configuration
The demos provide a UI to enter your S3 credentials. For repeated use, you can create a `config.json` in the specific demo folder (e.g., `demo/social/config.json`):

```json
{
  "s3": {
    "endpoint": "https://s3.us-east-1.amazonaws.com",
    "region": "us-east-1",
    "bucketName": "my-bucket",
    "accessKeyId": "...",
    "secretAccessKey": "..."
  },
  "appId": "social-demo"
}
```

## Deployment (Netlify)

You can easily host any of the demo apps for free on [Netlify](https://www.netlify.com/).

### Simple Drag & Drop
1. **Build the demo**: Run the build command for the app you want (e.g., `npx esbuild demo/social/src/app.ts --bundle --outfile=demo/social/bundle.js --platform=browser`).
2. **Login to Netlify**: Go to [Netlify Drop](https://app.netlify.com/drop).
3. **Upload**: Drag the entire demo folder (e.g., `demo/social/`) into the browser window.
4. **Done**: Your app will be live on an `https://...` URL in seconds.

*Note: Ensure your S3 bucket CORS policy allows requests from your Netlify domain.*

## Security Model

- **Identity**: Users are identified by a GUID (Public ID).
- **Isolation**: Data is stored under `${appId}/${userId}/${storeId}/`.
- **Discovery**: Public profiles and shared content are indexed in `${appId}/shared/`.
- **Encryption**:
    - **Private Data**: Encrypted with a key derived from your `privatePassphrase`.
    - **Public Data**: Encrypted with a key derived from your `publicPassphrase` (allows for public directories while preventing harvesting by bots without the passphrase/salt).
    - **Shared Docs**: Encrypted with a random key, which is then shared via the public index.

## Architecture

See [docs/Architecture.md](docs/Architecture.md) for detailed design diagrams and data flow.

## License

ISC