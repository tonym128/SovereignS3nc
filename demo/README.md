# SovereignS3nc Demos

This directory contains example applications built with SovereignS3nc to demonstrate various capabilities like offline-sync, conflict resolution, sharing, and binary assets.

## Available Demos

### 1. Social App (`demo/social`)
A fully decentralized "Twitter-like" social network.
- **Features**: 
  - User Profiles (Display Name, Bio, Avatar)
  - Activity Feed (Posts, Images)
  - Comments
  - **Federation**: Follow other users by their "Sovereign Address" (bucket/region/appId/userId).
  - **Auto-Discovery**: Automatically finds other users in the same bucket.
  - **Security**: Uses Public/Private passphrases for identity and feed encryption.

### 2. Notes App (`demo/notes`)
A classic offline-first note-taking application.
- **Features**:
  - Create, Edit, Delete notes.
  - Real-time sync.
  - Conflict resolution demonstration.

### 3. Chat App (`demo/chat`)
A simple chat room using the shared file system.
- **Features**:
  - Global chat room (shared/public path).
  - Message history.

### 4. Shopping List (`demo/shopping`)
A collaborative list application.
- **Features**:
  - Add/Remove items.
  - Check off items.
  - Multi-user sync on a shared list.

## How to Run

### 1. Prerequisites
- **Node.js** (v16+)
- **S3-Compatible Storage**: You need a bucket on AWS S3, MinIO, Garage, or Oracle OCI Object Storage.
- **CORS Configuration**: Your bucket **MUST** be configured to allow CORS for `localhost` (or wherever you host the app).

**Example CORS Policy (AWS/MinIO):**
```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag", "x-amz-meta-custom-header"]
    }
]
```

### 2. Build the Demos
The demos are written in TypeScript and need to be bundled for the browser. You can build them using `esbuild`.

Run the following commands from the **root** of the project:

```bash
# Build Social App
npx esbuild demo/social/src/app.ts --bundle --outfile=demo/social/bundle.js --sourcemap --platform=browser

# Build Notes App
npx esbuild demo/notes/src/app.ts --bundle --outfile=demo/notes/bundle.js --sourcemap --platform=browser

# Build Chat App
npx esbuild demo/chat/src/app.ts --bundle --outfile=demo/chat/bundle.js --sourcemap --platform=browser

# Build Shopping App
npx esbuild demo/shopping/src/app.ts --bundle --outfile=demo/shopping/bundle.js --sourcemap --platform=browser
```

### 3. Serve Locally
You need a static file server to serve the HTML and JS files.

```bash
# From the project root
npx http-server . -p 8080 --cors
```

### 4. Open in Browser
Navigate to the specific demo:

- **Social**: [http://127.0.0.1:8080/demo/social/](http://127.0.0.1:8080/demo/social/)
- **Notes**: [http://127.0.0.1:8080/demo/notes/](http://127.0.0.1:8080/demo/notes/)
- **Chat**: [http://127.0.0.1:8080/demo/chat/](http://127.0.0.1:8080/demo/chat/)
- **Shopping**: [http://127.0.0.1:8080/demo/shopping/](http://127.0.0.1:8080/demo/shopping/)

## Configuration
When you launch a demo, you will be prompted for your S3 credentials.

**Tip**: To avoid typing credentials every time, you can create a `config.json` file inside the specific demo folder (e.g., `demo/social/config.json`).

**Example `config.json`:**
```json
{
  "s3": {
    "endpoint": "https://s3.us-east-1.amazonaws.com",
    "region": "us-east-1",
    "bucketName": "my-demo-bucket",
    "accessKeyId": "AKIA...",
    "secretAccessKey": "SECRET..."
  },
  "appId": "social-demo-v1"
}
```
