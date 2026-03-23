# SovereignS3nc WebRTC Setup Guide

WebRTC mode allows SovereignS3nc to operate as a peer-to-peer (P2P) mesh network, bypassing S3 storage for data exchange between users.

There are two primary ways to use WebRTC with SovereignS3nc:

---

## 1. Local Mesh (Tab-to-Tab)
Ideal for multiple tabs of the same application on the same browser, or local network discovery using the `BroadcastChannel` API.

### Implementation Example:
```typescript
import { SovereignS3nc, WebRTCRemoteAdapter } from 'sovereigns3nc';

const userId = 'alice-123';
const adapter = new WebRTCRemoteAdapter(userId);

// Create a local mesh channel
const bc = new BroadcastChannel('sov-mesh-local');

// Connect the adapter to the broadcast channel
const peer = adapter.connectPeer((msg) => bc.postMessage(msg));
bc.onmessage = (e) => peer.receive(e.data);

const sov = new SovereignS3nc({
  paths: { appId: 'my-app', userId, storeId: 'main' },
  password: 'password'
}, adapter);

await sov.init();
```

---

## 2. Global Mesh (Peer-to-Peer over Internet)
For connecting users across different networks. This requires a **Signaling Server** to facilitate the initial handshake (Offer/Answer/ICE).

### Step A: Start the Signaling Server
SovereignS3nc includes a minimal signaling server in the `Setup/WebRTC` folder.
```bash
chmod +x Setup/WebRTC/run-signaling.sh
./Setup/WebRTC/run-signaling.sh
```

### Step B: Client Configuration (Manual)
To connect users over the internet, you must implement the signaling handshake logic in your application.

```typescript
const signaling = new WebSocket('ws://your-signaling-server:8890');
const adapter = new WebRTCRemoteAdapter(userId);

// 1. Connect new peers via signaling
signaling.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'offer') {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        const channel = pc.createDataChannel('sov-sync');
        
        // Link the Data Channel to the SovereignS3nc Adapter
        const peer = adapter.connectPeer((msg) => channel.send(msg));
        channel.onmessage = (e) => peer.receive(e.data);
        
        // ... Complete RTC Handshake (Answer/ICE Candidates)
    }
};
```

---

## 3. Zero-Infrastructure Signaling (No Server Required)

If you want to avoid hosting a signaling server entirely, you can use **Public WebTorrent Trackers**. These are "always-on" public servers that help peers find each other using the Bittorrent DHT.

### Implementation Concept:
You can use a library like `bittorrent-tracker` or `bugout` to find peers via public trackers:
1. Announce your `appId + userId` to a list of public trackers (e.g., `wss://tracker.openwebtorrent.com`).
2. The trackers return a list of other peers for the same ID.
3. Establish WebRTC connections directly using the tracker's signaling relay.

This method allows for a truly decentralized "trackerless" mesh where no single entity owns the signaling infrastructure.

## 4. Security Considerations
- **E2EE**: All data pushed or requested over WebRTC is still encrypted using the same `tweetnacl` X25519 identity keys used in S3 mode. Even if the signaling server is compromised, your data remains secure.
- **STUN/TURN**: For production use across restrictive firewalls, you should provide your own **TURN Server** (e.g., [Coturn](https://github.com/coturn/coturn)) in the `RTCPeerConnection` configuration.

## 4. Why use WebRTC mode?
- **Zero Cloud Costs**: Data is exchanged directly between users without hitting an S3 bucket.
- **Real-Time Sync**: P2P push messages provide near-instant updates across the mesh.
- **Offline Mesh**: If users are on the same local network, they can sync even if the internet is down.
