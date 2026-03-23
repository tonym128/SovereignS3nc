const { PeerServer } = require('peer');

/**
 * SovereignS3nc PeerJS Signaling Server
 * 
 * This server provides the signaling backbone for PeerJS connections.
 * It handles peer registration and handshake routing.
 */

const PORT = process.env.PORT || 9000;

const peerServer = PeerServer({ 
    port: PORT, 
    path: '/sov-mesh',
    allow_discovery: true 
});

peerServer.on('connection', (client) => {
    console.log(`[PeerJS] Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`[PeerJS] Client disconnected: ${client.getId()}`);
});

console.log(`[PeerJS] Signaling Server running on port ${PORT}`);
console.log(`[PeerJS] Path: /sov-mesh`);
