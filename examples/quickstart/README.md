# SovereignS3nc React Quickstart Sandbox

This is a ready-to-run template demonstrating [SovereignS3nc](https://github.com/tonym128/SovereignS3nc) with the official `@sovereigns3nc/react` hooks library in an offline-first, client-side encrypted architecture.

## 🚀 Run in Cloud Sandboxes (Zero Setup)

- **[⚡ Open in StackBlitz](https://stackblitz.com/github/tonym128/SovereignS3nc/tree/master/examples/quickstart)**
- **[📦 Open in CodeSandbox](https://codesandbox.io/p/sandbox/github/tonym128/SovereignS3nc/tree/master/examples/quickstart)**

## 💻 Local Development

1. Clone repository and navigate to this folder:
   ```bash
   cd examples/quickstart
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Open your browser at `http://localhost:5173`.

## 🛠 Features Demonstrated

- **Zero-Backend Offline First**: Uses browser `IndexedDB` with zero remote dependencies.
- **Client-Side E2EE & Cryptography**: Automatic keypair generation and encrypted storage.
- **Reactive Hooks**: `@sovereigns3nc/react` components including `<SovereignProvider>`, `useSovereign`, `useProfile`, `useFeed`, and `useSyncStatus`.
- **Keyset Cursor Pagination**: Infinite scroll capability with compound cursor index `(timestamp DESC, id DESC)`.
- **S3 & WebRTC Mesh Sync**: Toggle sync mode to S3 cloud storage or WebRTC peer meshes seamlessly.
