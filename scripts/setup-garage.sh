#!/bin/bash
set -e

# Setup directories
mkdir -p bin
mkdir -p tmp/garage/meta
mkdir -p tmp/garage/data

GARAGE_BIN="./bin/garage"

# 1. Install Garage if needed
if [ ! -f "$GARAGE_BIN" ]; then
    echo "Garage binary not found. Downloading..."
    # Attempt download
    if command -v curl >/dev/null 2>&1; then
        curl -L -o "$GARAGE_BIN" https://garagehq.deuxfleurs.fr/_releases/v1.0.0/x86_64-unknown-linux-musl/garage
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$GARAGE_BIN" https://garagehq.deuxfleurs.fr/_releases/v1.0.0/x86_64-unknown-linux-musl/garage
    else
        echo "Error: curl or wget not found."
        exit 1
    fi
    chmod +x "$GARAGE_BIN"
fi

echo "Garage version:"
$GARAGE_BIN --version

# 2. Configure Garage
if command -v openssl >/dev/null 2>&1; then
    RPC_SECRET=$(openssl rand -hex 32)
else
    RPC_SECRET="fixed-secret-for-testing-1234567890abcdef"
fi

CONFIG_FILE="tmp/garage.toml"

# Ensure absolute paths for config
PWD_DIR=$(pwd)

cat <<EOF > $CONFIG_FILE
metadata_dir = "$PWD_DIR/tmp/garage/meta"
data_dir = "$PWD_DIR/tmp/garage/data"
replication_mode = "none"

rpc_bind_addr = "127.0.0.1:3911"
rpc_public_addr = "127.0.0.1:3911"
rpc_secret = "$RPC_SECRET"

[s3_api]
s3_region = "us-east-1"
api_bind_addr = "127.0.0.1:3905" 
root_domain = ".s3.local"

[admin]
api_bind_addr = "127.0.0.1:3906"
EOF

# 3. Start Garage
# Kill previous instance if running
pkill -f "$GARAGE_BIN" || true
# Wait a moment for release
sleep 1

echo "Starting Garage..."
setsid $GARAGE_BIN -c $CONFIG_FILE server > tmp/garage.log 2>&1 < /dev/null &
GARAGE_PID=$!

echo "Waiting for Garage..."
sleep 3

# 4. Initialize Layout
# We need to get Node ID.
# Try multiple times
NODE_ID=""
for i in {1..5}; do
    NODE_ID=$($GARAGE_BIN -c $CONFIG_FILE node id 2>/dev/null | head -n 1 | cut -d '@' -f 1)
    if [ ! -z "$NODE_ID" ]; then
        break
    fi
    sleep 1
done

if [ -z "$NODE_ID" ]; then
    echo "Failed to get Node ID. Check logs."
    cat tmp/garage.log
    exit 1
fi

echo "Node ID: $NODE_ID"
$GARAGE_BIN -c $CONFIG_FILE layout assign -z us-east-1 -c 1G $NODE_ID > /dev/null 2>&1 || true
$GARAGE_BIN -c $CONFIG_FILE layout apply --version 1 > /dev/null 2>&1 || true

# 5. Create Key & Bucket
echo "Creating Key..."
KEY_OUTPUT=$($GARAGE_BIN -c $CONFIG_FILE key create demo-key 2>&1)
# If creation failed, try info
if [ $? -ne 0 ]; then
    echo "Key create failed (maybe exists), fetching info..."
    KEY_OUTPUT=$($GARAGE_BIN -c $CONFIG_FILE key info demo-key)
fi

ACCESS_KEY=$(echo "$KEY_OUTPUT" | grep "Key ID" | awk '{print $3}')
SECRET_KEY=$(echo "$KEY_OUTPUT" | grep "Secret key" | awk '{print $3}')

if [ -z "$ACCESS_KEY" ]; then
    echo "Failed to get Access Key. Output:"
    echo "$KEY_OUTPUT"
    exit 1
fi

echo "Creating Bucket..."
$GARAGE_BIN -c $CONFIG_FILE bucket create sovereign-demo || true
$GARAGE_BIN -c $CONFIG_FILE bucket allow sovereign-demo --read --write --owner --key "$ACCESS_KEY"

# 6. Write Config
cat <<EOF > .test-env.json
{
  "endpoint": "http://127.0.0.1:3905",
  "region": "us-east-1",
  "bucketName": "sovereign-demo",
  "accessKeyId": "$ACCESS_KEY",
  "secretAccessKey": "$SECRET_KEY"
}
EOF

echo "Test environment ready. Config written to .test-env.json"
echo "Garage running with PID $GARAGE_PID. Log at tmp/garage.log"