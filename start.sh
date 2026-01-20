#!/bin/bash
set -e

# Debug: Check version
echo "Garage Version:"
garage --version

# 1. Configure Garage
# mkdir -p /etc/garage # Not strictly needed if file is at /etc/garage.toml
if [ ! -f /etc/garage.toml ]; then
    echo "Generating Garage config..."
    RPC_SECRET=$(openssl rand -hex 32)
    cat <<EOF > /etc/garage.toml
metadata_dir = "/tmp/garage/meta"
data_dir = "/tmp/garage/data"
replication_mode = "none"

# Legacy / Flat config (for compatibility or if binary expects it)
rpc_bind_addr = "127.0.0.1:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$RPC_SECRET"

[rpc]
bind_addr = "127.0.0.1:3901"
public_addr = "127.0.0.1:3901"
secret = "$RPC_SECRET"

[s3_api]
s3_region = "us-east-1"
api_bind_addr = "0.0.0.0:3900"
root_domain = ".s3.local"

[admin]
api_bind_addr = "0.0.0.0:3903"

[s3_web]
bind_addr = "0.0.0.0:3902"
root_domain = ".web.local"
index = "index.html"
EOF
fi

# 2. Start Garage
echo "Starting Garage..."
garage server > /tmp/garage.log 2>&1 &
GARAGE_PID=$!

# Wait for Garage to be ready
echo "Waiting for Garage to initialize..."
sleep 5

# 3. Initialize Layout (Single Node)
# Only if not already initialized (check if status shows non-empty layout)
# But since this is likely a fresh container, we assume fresh.
# We need to capture the node ID.
# Try 'garage node id' first (available in newer versions)
# Extract just the hex ID (before @)
NODE_ID=$(garage node id | cut -d '@' -f 1 | tr -d '\r')

if [ -z "$NODE_ID" ]; then
    # Fallback parsing
    NODE_ID=$(garage status | grep "ID:" | head -n 1 | awk '{print $2}')
fi

if [ -z "$NODE_ID" ]; then
    echo "ERROR: Could not detect Node ID."
    echo "garage status output:"
    garage status
    exit 1
fi

echo "Detected Node ID: $NODE_ID"
SHORT_ID=${NODE_ID:0:16}

# Wait for node to be healthy/visible
echo "Waiting for node to be ready..."
for i in {1..30}; do
    if garage status | grep -q "$SHORT_ID"; then
        echo "Node found in status."
        break
    fi
    echo "Waiting for node to appear in status... ($i/30)"
    if [ $((i % 5)) -eq 0 ]; then
        echo "--- garage status ---"
        garage status
        echo "---------------------"
    fi
    sleep 1
done

# Assign layout if not already assigned
echo "Assigning layout..."
garage layout assign -z us-east-1 -c 1G $NODE_ID || true
echo "Current layout:"
garage layout show
garage layout apply --version 1 || true

echo "--- Post-apply status ---"
garage status
echo "-------------------------"

# 4. Create Key
echo "Creating API Key..."
# Check if key exists, if so delete (to get fresh secret) or just create new
# Since ephemeral container, just create.
KEY_OUTPUT=$(garage key create demo-key)
ACCESS_KEY=$(echo "$KEY_OUTPUT" | grep "Key ID" | awk '{print $3}')
SECRET_KEY=$(echo "$KEY_OUTPUT" | grep "Secret key" | awk '{print $3}')

# 5. Create Bucket
echo "Creating Bucket 'sovereign-demo'..."
garage bucket create sovereign-demo || true
garage bucket allow sovereign-demo --read --write --owner --key demo-key || true

# Make it public for public sharing features
# garage bucket allow sovereign-demo --read || true

# 5b. Configure CORS
echo "Applying CORS configuration..."
ACCESS_KEY=$ACCESS_KEY SECRET_KEY=$SECRET_KEY node demo/configure_cors.js

# 5c. Generate demo config for auto-fill
echo "Generating demo config.json..."
cat <<EOF > demo/config.json
{
  "s3": {
    "endpoint": "http://localhost:3900",
    "bucketName": "sovereign-demo",
    "region": "us-east-1",
    "accessKeyId": "$ACCESS_KEY",
    "secretAccessKey": "$SECRET_KEY"
  },
  "appId": "social-app"
}
EOF

# 6. Output Access Info
echo "================================================================"
echo "          SOVEREIGN S3NC DEMO ENV SETUP COMPLETE"
echo "================================================================"
echo ""
echo "Website URL:      http://localhost:8080/demo/"
echo ""
echo "--- S3 CONNECTION DETAILS ---"
echo "Endpoint:     http://localhost:3900"
echo "Bucket Name:  sovereign-demo"
echo "Region:       us-east-1"
echo "Access Key:   $ACCESS_KEY"
echo "Secret Key:   $SECRET_KEY"
# echo "KEY OUTPUT:   $KEY_OUTPUT"
echo "================================================================"

# 7. Start Web Server
# We serve the current directory (.) so that /demo/index.html is the path
echo "Starting Web Server..."
http-server . -p 8080 --cors