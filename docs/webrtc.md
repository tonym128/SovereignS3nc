# SovereignS3nc WebRTC & P2P Guide

WebRTC mode allows SovereignS3nc to operate as a peer-to-peer (P2P) mesh network, bypassing S3 storage for data exchange between users.

---

## 1. Local Mesh (Tab-to-Tab)
Ideal for multiple tabs of the same application on the same browser using the `BroadcastChannel` API.

### Implementation:
```typescript
import { SovereignS3nc, WebRTCRemoteAdapter } from 'sovereigns3nc';

const userId = 'alice-123';
const adapter = new WebRTCRemoteAdapter(userId);
const bc = new BroadcastChannel('sov-mesh-local');

// Link adapter to BroadcastChannel
const peer = adapter.connectPeer((msg) => bc.postMessage(msg));
bc.onmessage = (e) => peer.receive(e.data);

const sov = await SovereignS3nc.create({
  paths: { appId: 'my-app', userId, storeId: 'main' },
  password: 'password'
}, adapter);
```

---

## 2. Cloud Signaling (PeerJS)
The easiest way to connect users across the internet. Uses a signaling server (like the public PeerJS cloud) to facilitate the handshake.

### Implementation:
```typescript
import Peer from 'peerjs';

const peerId = `my-app-${userId}`;
const peer = new Peer(peerId);

peer.on('connection', (conn) => {
    // Connect incoming PeerJS connection to Sovereign adapter
    const sovPeer = adapter.connectPeer((msg) => conn.send(msg));
    conn.on('data', (data) => sovPeer.receive(data as string));
});
```

---

## 3. Serverless / Zero-Infrastructure (QR & BLE)
For 100% off-grid or high-security scenarios where no signaling server is trusted.

### Using `NativeWebRTCTransport`
SovereignS3nc provides a native transport wrapper to manage raw WebRTC connections.

```typescript
import { NativeWebRTCTransport, SovereignS3nc } from 'sovereigns3nc';

const transport = new NativeWebRTCTransport(userId);

// Initiator: Generate QR Code
const offer = await transport.createOffer();
showQRCode(JSON.stringify(offer));

// Receiver: Scan QR Code
const answer = await transport.handleOffer(scannedOffer.sdp);
showQRCode(JSON.stringify(answer));

// Finalize: Initiator scans answer
await transport.handleAnswer(scannedAnswer.sdp);

// Once connected, plug into Sovereign
transport.onConnected = () => {
    sovereign.connectNativeRTC(transport);
};
```

### Bluetooth Discovery (BLE)
Use the `BLESignaling` utility to perform the handshake via Bluetooth Low Energy.

```typescript
import { BLESignaling } from 'sovereigns3nc';

await BLESignaling.scanAndPair(async (offerStr) => {
    const offer = JSON.parse(offerStr);
    const answer = await transport.handleOffer(offer.sdp);
    return JSON.stringify(answer);
});
```

---

## 4. Architecture: The Gossip Engine
When using WebRTC, SovereignS3nc acts as a **Relay Node**. Even if you don't follow "User C," your browser may relay encrypted data between "User A" and "User B" if they are both connected to you.

- **Deduplication**: The library ensures the same message is never processed or relayed twice using a `msgId` cache.
- **TTL (Time To Live)**: Gossip messages are limited to 5 hops by default to prevent network congestion.
- **Privacy**: Relay nodes cannot decrypt the data they are passing; only the intended recipient (or those with the module keys) can read the content.

---

## 5. Security & NAT Traversal
For reliable connections across restrictive firewalls (Corporate/Mobile), you should provide a **TURN Server**.

```typescript
const transport = new NativeWebRTCTransport(userId, [
    { urls: 'stun:stun.l.google.com:19302' },
    { 
        urls: 'turn:your-turn-server.com', 
        username: 'user', 
        credential: 'password' 
    }
]);
```
