#!/bin/bash

# dev.sh - Development environment management script for SovereignS3nc (Local Binary Mode)

set -e

# Configuration
SOCIAL_CONFIG="demo/social/config.json"
BANKY_CONFIG="demo/banky/config.json"
BUCKET_NAME="sovereign-demo"
KEY_NAME="dev-key"
GARAGE_BINARY="./bin/garage"
GARAGE_TOML="garage.toml"
GARAGE_LOCAL_TOML="garage_local.toml"
DATA_DIR="./garage_data"
LOG_FILE="garage.log"

function dev() {
    echo "--- Cleaning up previous runs ---"
    stop
    sleep 1

    echo "--- Preparing Local Environment ---"
    mkdir -p "$DATA_DIR/meta" "$DATA_DIR/data"

    # Create a local version of the config pointing to project directories
    echo "Creating $GARAGE_LOCAL_TOML..."
    cp "$GARAGE_TOML" "$GARAGE_LOCAL_TOML"
    
    # Update paths in local config to use local directory instead of /var/lib/garage
    sed -i "s|metadata_dir = \".*\"|metadata_dir = \"$DATA_DIR/meta\"|g" "$GARAGE_LOCAL_TOML"
    sed -i "s|data_dir = \".*\"|data_dir = \"$DATA_DIR/data\"|g" "$GARAGE_LOCAL_TOML"
    sed -i "s|rpc_bind_addr = \".*\"|rpc_bind_addr = \"127.0.0.1:3901\"|g" "$GARAGE_LOCAL_TOML"
    sed -i "s|s3_region = \".*\"|s3_region = \"garage\"|g" "$GARAGE_LOCAL_TOML"

    echo "--- Starting Garage Binary ---"
    nohup $GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" server > "$LOG_FILE" 2>&1 &
    GARAGE_PID=$!
    disown $GARAGE_PID
    echo $GARAGE_PID > .garage.pid

    # Wait for Garage to initialize and show a Node ID
    echo "Waiting for Garage to initialize (PID: $GARAGE_PID)..."
    while true; do
        STATUS_OUT=$($GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" status 2>/dev/null || true)
        NODE_ID=$(echo "$STATUS_OUT" | grep -v "====" | grep -v "ID" | grep -v "^$" | awk '{print $1}' | head -n 1)
        
        if [ ! -z "$NODE_ID" ]; then
            break
        fi
        
        if ! ps -p $GARAGE_PID > /dev/null; then
            echo "Error: Garage failed to start. Check $LOG_FILE"
            exit 1
        fi
        sleep 2
    done

    echo "Configuring Garage layout (Node: $NODE_ID)..."
    $GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" layout assign "$NODE_ID" -c 1G -z local
    
    STAGED_INFO=$($GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" layout show)
    CURRENT_VERSION=$(echo "$STAGED_INFO" | grep "Staged edit" | sed -E 's/.*v([0-9]+).*/\1/' || echo "")
    if [ -z "$CURRENT_VERSION" ]; then CURRENT_VERSION="1"; fi
    
    echo "Applying layout version $CURRENT_VERSION..."
    $GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" layout apply --version "$CURRENT_VERSION"

    echo "Creating S3 credentials and bucket..."
    KEY_OUTPUT=$($GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" key create "$KEY_NAME")
    ACCESS_KEY=$(echo "$KEY_OUTPUT" | grep "Key ID" | awk '{print $3}')
    SECRET_KEY=$(echo "$KEY_OUTPUT" | grep "Secret key" | awk '{print $3}')

    $GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" bucket create "$BUCKET_NAME"
    $GARAGE_BINARY -c "$GARAGE_LOCAL_TOML" bucket allow "$BUCKET_NAME" --read --write --owner --key "$KEY_NAME"

    echo "--- Starting CORS Proxy (Port 8889) ---"
    touch proxy.log
    chmod 666 proxy.log
    nohup node scripts/proxy.js >> proxy.log 2>&1 &
    PROXY_PID=$!
    disown $PROXY_PID
    echo $PROXY_PID > .proxy.pid

    echo "Updating Config Files..."
    JSON_CONFIG="{
    \"endpoint\": \"http://127.0.0.1:8889\",
    \"region\": \"garage\",
    \"accessKeyId\": \"$ACCESS_KEY\",
    \"secretAccessKey\": \"$SECRET_KEY\",
    \"bucketName\": \"$BUCKET_NAME\"
}"
    echo "$JSON_CONFIG" > "$SOCIAL_CONFIG"
    echo "$JSON_CONFIG" > "$BANKY_CONFIG"

    echo "--- Building Demo Apps ---"
    npm run build:social
    npm run build:banky

    echo "--- Starting Social Web Server (Port 8888) ---"
    nohup python3 -m http.server 8888 --bind 127.0.0.1 --directory demo/social > social_web.log 2>&1 &
    SOCIAL_PID=$!
    disown $SOCIAL_PID
    echo $SOCIAL_PID > .social_web.pid

    echo "--- Starting Banky Web Server (Port 8887) ---"
    nohup python3 -m http.server 8887 --bind 127.0.0.1 --directory demo/banky > banky_web.log 2>&1 &
    BANKY_PID=$!
    disown $BANKY_PID
    echo $BANKY_PID > .banky_web.pid

    echo "------------------------------------------------"
    echo "Development environment is ready!"
    echo "Garage S3 API (Direct):  http://127.0.0.1:3900"
    echo "Garage S3 API (Proxy):   http://127.0.0.1:8889"
    echo "Social Demo App:         http://127.0.0.1:8888"
    echo "Banky Demo App:          http://127.0.0.1:8887"
    echo "------------------------------------------------"
    echo "Use './dev.sh stop' to shut down services."
}

function stop() {
    echo "Stopping services and cleaning up..."
    
    [ -f .social_web.pid ] && kill $(cat .social_web.pid) 2>/dev/null && rm .social_web.pid
    [ -f .banky_web.pid ] && kill $(cat .banky_web.pid) 2>/dev/null && rm .banky_web.pid
    [ -f .proxy.pid ] && kill $(cat .proxy.pid) 2>/dev/null && rm .proxy.pid
    [ -f .garage.pid ] && kill $(cat .garage.pid) 2>/dev/null && rm .garage.pid
    
    # Backup cleanup in case PIDs were lost
    pkill -9 garage 2>/dev/null || true
    pkill -f "node scripts/proxy.js" 2>/dev/null || true
    pkill -f "python3 -m http.server 127.0.0.1 8888" 2>/dev/null || true
    pkill -f "python3 -m http.server 127.0.0.1 8887" 2>/dev/null || true

    echo "Removing temporary data..."
    rm -rf "$DATA_DIR" "$GARAGE_LOCAL_TOML" "$LOG_FILE" "*_web.log" "proxy.log"

    RESET_CONFIG="{
    \"endpoint\": \"http://127.0.0.1:8889\",
    \"region\": \"garage\",
    \"accessKeyId\": \"YOUR_ACCESS_KEY\",
    \"secretAccessKey\": \"YOUR_SECRET_KEY\",
    \"bucketName\": \"your-bucket-name\"
}"

    if [ -f "$SOCIAL_CONFIG" ]; then
        echo "Resetting $SOCIAL_CONFIG..."
        echo "$RESET_CONFIG" > "$SOCIAL_CONFIG"
    fi
    if [ -f "$BANKY_CONFIG" ]; then
        echo "Resetting $BANKY_CONFIG..."
        echo "$RESET_CONFIG" > "$BANKY_CONFIG"
    fi
    echo "Cleanup complete."
}

case "$1" in
    dev) dev ;;
    stop) stop ;;
    *) echo "Usage: $0 {dev|stop}"; exit 1 ;;
esac
