#!/bin/bash
set -e

# 1. Configure Garage
mkdir -p /etc/garage
if [ ! -f /etc/garage/garage.toml ]; then
    echo "Generating Garage config..."
    cat <<EOF > /etc/garage/garage.toml
metadata_dir = "/tmp/garage/meta"
data_dir = "/tmp/garage/data"
replication_mode = "none"

[rpc]
bind_addr = "127.0.0.1:3901"
public_addr = "127.0.0.1:3901"

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
NODE_ID=$(garage status | grep "ID:" | head -n 1 | awk '{print $2}')
if [ -z "$NODE_ID" ]; then
    # Fallback parsing depending on garage version output
    NODE_ID=$(garage status | grep "=>" | awk '{print $1}')
fi

echo "Detected Node ID: $NODE_ID"

# Assign layout if not already assigned
garage layout assign -z us-east-1 -c 1 $NODE_ID || true
garage layout apply --version 1 || true

# 4. Create Key
echo "Creating API Key..."
# Check if key exists, if so delete (to get fresh secret) or just create new
# Since ephemeral container, just create.
KEY_OUTPUT=$(garage key create demo-key)
ACCESS_KEY=$(echo "$KEY_OUTPUT" | grep "Key ID" | awk '{print $3}')
SECRET_KEY=$(echo "$KEY_OUTPUT" | grep "Secret Key" | awk '{print $3}')

# 5. Create Bucket
echo "Creating Bucket 'sovereign-demo'..."
garage bucket create sovereign-demo || true
garage bucket allow sovereign-demo --read --write --key demo-key || true

# Make it public for public sharing features
garage bucket allow sovereign-demo --read --public || true

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
echo ""
echo "================================================================"

# 7. Start Web Server
# We serve the current directory (.) so that /demo/index.html is the path
echo "Starting Web Server..."
http-server . -p 8080
