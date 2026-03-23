const http = require('http');
const WebSocket = require('ws');

/**
 * SovereignS3nc Minimal Signaling Server
 * 
 * This server facilitates WebRTC 'Handshakes' (Offers/Answers/ICE Candidates)
 * between peers so they can establish a direct P2P data connection.
 */

const PORT = process.env.PORT || 8890;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SovereignS3nc Signaling Server is Running');
});

const wss = new WebSocket.Server({ server });

// Map to track connected peers
const peers = new Map();

wss.on('connection', (ws) => {
    let peerId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // 1. Peer Registration
            if (data.type === 'register') {
                peerId = data.peerId;
                peers.set(peerId, ws);
                console.log(`[Signaling] Peer Registered: ${peerId}`);
                broadcastPeers();
                return;
            }

            // 2. Peer-to-Peer Signaling (Offer, Answer, ICE Candidate)
            if (data.target && peers.has(data.target)) {
                console.log(`[Signaling] Routing ${data.type} from ${peerId} to ${data.target}`);
                peers.get(data.target).send(JSON.stringify({
                    ...data,
                    sender: peerId
                }));
            }
        } catch (e) {
            console.error('[Signaling] Error processing message:', e.message);
        }
    });

    ws.on('close', () => {
        if (peerId) {
            peers.delete(peerId);
            console.log(`[Signaling] Peer Disconnected: ${peerId}`);
            broadcastPeers();
        }
    });

    function broadcastPeers() {
        const peerList = Array.from(peers.keys());
        const msg = JSON.stringify({ type: 'peer_list', peers: peerList });
        peers.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
            }
        });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Signaling] Server listening on ws://0.0.0.0:${PORT}`);
    console.log(`[Signaling] Ready to facilitate WebRTC handshakes.`);
});
