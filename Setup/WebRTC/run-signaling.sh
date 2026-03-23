#!/bin/bash

# Start the WebRTC Signaling Server
# Port can be overridden via PORT=8890 ./run-signaling.sh

echo "Starting SovereignS3nc WebRTC Signaling Server..."
node Setup/WebRTC/signaling.js
