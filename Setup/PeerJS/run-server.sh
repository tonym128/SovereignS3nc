#!/bin/bash

# Start the PeerJS Signaling Server
# Port can be overridden via PORT=9000 ./run-server.sh

echo "Starting SovereignS3nc PeerJS Signaling Server..."
node Setup/PeerJS/server.js
