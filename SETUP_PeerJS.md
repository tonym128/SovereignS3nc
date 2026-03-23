# SovereignS3nc PeerJS Setup Guide

PeerJS simplifies WebRTC peer-to-peer (P2P) connections by providing a complete signaling solution out of the box.

## 1. Why PeerJS?
- **Simplified Signaling**: No need to manually handle SDP offers/answers or ICE candidates.
- **Public Cloud Option**: You can use the free [PeerJS Cloud](https://peerjs.com/peerserver) for testing without any server setup.
- **Easy Self-Hosting**: Running your own signaling server is trivial for production use.

## 2. Option A: Using PeerJS Public Cloud (Zero-Infrastructure)
This is the recommended path for developers who want "serverless" P2P sync without any server management.

**Why use it?**
- **Zero Configuration**: Just initialize `new Peer()` without any options.
- **High Availability**: Managed by the PeerJS community.
- **Privacy**: Only handles the handshake; SovereignS3nc's E2EE ensures your data remains private.

### Code Snippet:
```typescript
import { SovereignS3nc, WebRTCRemoteAdapter } from 'sovereigns3nc';
import Peer from 'peerjs';

const userId = 'alice-123';
const adapter = new WebRTCRemoteAdapter(userId);

// No options passed = uses PeerJS Public Cloud automatically
const peer = new Peer(`${appId}-${userId}`); 

peer.on('connection', (conn) => {
    const peerInterface = adapter.connectPeer((msg) => conn.send(msg));
    conn.on('data', (data) => peerInterface.receive(data as string));
});

// To connect to a specific friend
const conn = peer.connect(`${appId}-bob-456`);
const peerInterface = adapter.connectPeer((msg) => conn.send(msg));
conn.on('data', (data) => peerInterface.receive(data as string));
```

## 3. Option B: Self-Hosted PeerJS Server
For production, you should run your own signaling server to ensure availability and privacy.

### Step 1: Start the Server
SovereignS3nc includes a PeerJS server script:
```bash
chmod +x Setup/PeerJS/run-server.sh
./Setup/PeerJS/run-server.sh
```
By default, it runs on port **9000** with the path **/sov-mesh**.

### Step 2: Client Configuration
Point your clients to your own server:

```typescript
const peer = new Peer(`${appId}-${userId}`, {
    host: 'your-signaling-server.com',
    port: 9000,
    path: '/sov-mesh',
    secure: true // Use true if using HTTPS
});
```

## 4. Discovery & Mesh Building
Because SovereignS3nc is decentralized, you need a way to find other Peer IDs. Common strategies include:
- **Known Friends**: Connect to User IDs you have previously followed.
- **Bootstrap Peers**: Always connect to a set of "always-on" stable nodes.
- **Discovery Map**: Maintain a local cache of recently seen Peer IDs.

## 5. Security
Even when using the public PeerJS cloud, **all data remains end-to-end encrypted**. PeerJS only sees the encrypted blobs and metadata; the identity keys (`tweetnacl`) are never shared with the signaling server.
