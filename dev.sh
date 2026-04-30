#!/bin/bash

# dev.sh - Development environment management script for SovereignS3nc (RustFS Mode)

set -e

# Configuration
SOCIAL_CONFIG="demo/social/config.json"
BANKY_CONFIG="demo/banky/config.json"
BUCKET_NAME="sovereign-demo"
RUSTFS_BINARY="./bin/rustfs"
RC_BINARY="./bin/rc"
DATA_DIR="./rustfs_data"
LOG_FILE="rustfs.log"
RUSTFS_PORT=9000
RUSTFS_ROOT_KEY="rustfsroot"
RUSTFS_ROOT_SECRET="rustfsrootsecret"

function check_binaries() {
    if [ ! -f "$RUSTFS_BINARY" ]; then
        echo "--- Downloading RustFS Binary ---"
        mkdir -p bin
        curl -L https://dl.rustfs.com/artifacts/rustfs/release/rustfs-linux-x86_64-musl-latest.zip -o bin/rustfs.zip
        cd bin && unzip -o rustfs.zip && chmod +x rustfs && rm rustfs.zip && cd ..
    fi
    if [ ! -f "$RC_BINARY" ]; then
        echo "--- Downloading RustFS CLI (rc) ---"
        mkdir -p bin
        curl -L https://github.com/rustfs/cli/releases/download/v0.1.7/rustfs-cli-linux-amd64-v0.1.7.tar.gz -o bin/rc.tar.gz
        cd bin && tar -xzf rc.tar.gz && chmod +x rc && rm rc.tar.gz && cd ..
    fi
}

function dev() {
    check_binaries
    echo "--- Cleaning up previous runs ---"
    stop
    sleep 2

    echo "--- Preparing Local Environment ---"
    mkdir -p "$DATA_DIR"

    echo "--- Starting RustFS Binary ---"
    # Note: absolute path for data dir is usually safer for rustfs
    RUST_LOG=error nohup $RUSTFS_BINARY server \
        --address "127.0.0.1:$RUSTFS_PORT" \
        --access-key "$RUSTFS_ROOT_KEY" \
        --secret-key "$RUSTFS_ROOT_SECRET" \
        --console-enable \
        "$(pwd)/$DATA_DIR" > "$LOG_FILE" 2>&1 &
    RUSTFS_PID=$!
    disown $RUSTFS_PID
    echo $RUSTFS_PID > .rustfs.pid

    echo "Waiting for RustFS to initialize..."
    for i in {1..30}; do
        if curl -s "http://127.0.0.1:$RUSTFS_PORT" > /dev/null; then
            break
        fi
        if ! ps -p $RUSTFS_PID > /dev/null; then
            echo "Error: RustFS failed to start. Check $LOG_FILE"
            exit 1
        fi
        sleep 1
    done
    sleep 5 # Extra wait for IAM/Console to be fully ready

    echo "Configuring RustFS buckets and keys..."
    $RC_BINARY alias set local "http://127.0.0.1:$RUSTFS_PORT" "$RUSTFS_ROOT_KEY" "$RUSTFS_ROOT_SECRET" > /dev/null
    
    # Create Admin Key
    ADMIN_ACCESS="admin-key"
    ADMIN_SECRET="admin-secret-123"
    $RC_BINARY admin user add local "$ADMIN_ACCESS" "$ADMIN_SECRET" > /dev/null || true
    
    # Create Admin Policy (Full bucket access for development)
    cat <<EOF > admin-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME",
                "arn:aws:s3:::$BUCKET_NAME/*"
            ]
        }
    ]
}
EOF
    $RC_BINARY admin policy rm local sov-admin > /dev/null || true
    $RC_BINARY admin policy create local sov-admin admin-policy.json > /dev/null || true
    $RC_BINARY admin policy attach local sov-admin --user "$ADMIN_ACCESS" > /dev/null || true
    rm admin-policy.json

    # Create User Key
    USER_ACCESS="user-key"
    USER_SECRET="user-secret-123"
    $RC_BINARY admin user add local "$USER_ACCESS" "$USER_SECRET" > /dev/null || true
    
    # Create User Policy (Specific Allows for test users, ensuring admin isolation and functional discovery)
    cat <<EOF > user-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowListBucket",
            "Effect": "Allow",
            "Action": ["s3:ListBucket"],
            "Resource": ["arn:aws:s3:::$BUCKET_NAME"]
        },
        {
            "Sid": "DenyListAdmin",
            "Effect": "Deny",
            "Action": ["s3:ListBucket"],
            "Resource": ["arn:aws:s3:::$BUCKET_NAME"],
            "Condition": {
                "StringLike": {
                    "s3:prefix": ["*/admin/*"]
                }
            }
        },
        {
            "Sid": "AllowAppAccess",
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME/*/regular-user/*",
                "arn:aws:s3:::$BUCKET_NAME/*/new-user/*",
                "arn:aws:s3:::$BUCKET_NAME/*/evil-user/*",
                "arn:aws:s3:::$BUCKET_NAME/*/user-*/*",
                "arn:aws:s3:::$BUCKET_NAME/*/alice-*/*",
                "arn:aws:s3:::$BUCKET_NAME/*/bob-*/*",
                "arn:aws:s3:::$BUCKET_NAME/*/global/*",
                "arn:aws:s3:::$BUCKET_NAME/*/*/social/*"
            ]
        },
        {
            "Sid": "DenyAdminData",
            "Effect": "Deny",
            "Action": ["s3:*"],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME/*/admin/data/*",
                "arn:aws:s3:::$BUCKET_NAME/*/admin/admin.probe"
            ]
        },
        {
            "Sid": "DenyAdminKeyWrite",
            "Effect": "Deny",
            "Action": ["s3:PutObject", "s3:DeleteObject"],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME/*/admin/public_key.json"
            ]
        },

        {
            "Sid": "AllowAdminReporting",
            "Effect": "Allow",
            "Action": ["s3:PutObject"],
            "Resource": ["arn:aws:s3:::$BUCKET_NAME/*/admin/reports/*"]
        },
        {
            "Sid": "AllowAdminPublicKey",
            "Effect": "Allow",
            "Action": ["s3:GetObject"],
            "Resource": ["arn:aws:s3:::$BUCKET_NAME/*/admin/public_key.json"]
        }
    ]
}
EOF
    $RC_BINARY admin policy rm local sov-user > /dev/null || true
    $RC_BINARY admin policy create local sov-user user-policy.json > /dev/null || true
    $RC_BINARY admin policy attach local sov-user --user "$USER_ACCESS" > /dev/null || true
    rm user-policy.json

    # Create Bucket
    $RC_BINARY mb "local/$BUCKET_NAME" > /dev/null || true

    echo "Configuring CORS for $BUCKET_NAME..."
    node scripts/set-cors.js "http://127.0.0.1:$RUSTFS_PORT" "rustfs" "$ADMIN_ACCESS" "$ADMIN_SECRET" "$BUCKET_NAME"

    echo "Updating Config Files..."
    JSON_CONFIG="{
    \"endpoint\": \"http://127.0.0.1:$RUSTFS_PORT\",
    \"region\": \"rustfs\",
    \"accessKeyId\": \"$USER_ACCESS\",
    \"secretAccessKey\": \"$USER_SECRET\",
    \"bucketName\": \"$BUCKET_NAME\"
}"
    echo "$JSON_CONFIG" > "$SOCIAL_CONFIG"
    echo "$JSON_CONFIG" > "$BANKY_CONFIG"

    # Also save admin config for reference/manual testing
    echo "{
    \"endpoint\": \"http://127.0.0.1:$RUSTFS_PORT\",
    \"region\": \"rustfs\",
    \"accessKeyId\": \"$ADMIN_ACCESS\",
    \"secretAccessKey\": \"$ADMIN_SECRET\",
    \"bucketName\": \"$BUCKET_NAME\"
}" > "demo/social/admin_config.json"

    echo "--- Building Demo Apps ---"
    npm run build:social
    npm run build:social-local
    npm run build:banky

    echo "--- Starting Social Web Server (Port 8888) ---"
    nohup python3 -m http.server 8888 --bind 127.0.0.1 --directory demo/social > social_web.log 2>&1 &
    SOCIAL_PID=$!
    disown $SOCIAL_PID
    echo $SOCIAL_PID > .social_web.pid

    echo "--- Starting Social Local Web Server (Port 8886) ---"
    nohup python3 -m http.server 8886 --bind 127.0.0.1 --directory demo/social-local > social_local_web.log 2>&1 &
    SOCIAL_LOCAL_PID=$!
    disown $SOCIAL_LOCAL_PID
    echo $SOCIAL_LOCAL_PID > .social_local_web.pid

    echo "--- Starting Banky Web Server (Port 8887) ---"
    nohup python3 -m http.server 8887 --bind 127.0.0.1 --directory demo/banky > banky_web.log 2>&1 &
    BANKY_PID=$!
    disown $BANKY_PID
    echo $BANKY_PID > .banky_web.pid

    echo "------------------------------------------------"
    echo "RustFS Development environment is ready!"
    echo "RustFS S3 API:           http://127.0.0.1:9000"
    echo "Social Demo App:         http://127.0.0.1:8888"
    echo "Banky Demo App:          http://127.0.0.1:8887"
    echo ""
    echo "ADMIN CREDENTIALS (for manual testing):"
    echo "Access Key: $ADMIN_ACCESS"
    echo "Secret Key: $ADMIN_SECRET"
    echo "------------------------------------------------"
    echo "Use './dev.sh stop' to shut down services."
    echo "To restart, use './dev.sh start'"
}

function stop() {
    echo "Stopping services and cleaning up..."
    
    [ -f .social_web.pid ] && kill $(cat .social_web.pid) 2>/dev/null && rm .social_web.pid || true
    [ -f .social_local_web.pid ] && kill $(cat .social_local_web.pid) 2>/dev/null && rm .social_local_web.pid || true
    [ -f .banky_web.pid ] && kill $(cat .banky_web.pid) 2>/dev/null && rm .banky_web.pid || true
    [ -f .proxy.pid ] && kill $(cat .proxy.pid) 2>/dev/null && rm .proxy.pid || true
    [ -f .rustfs.pid ] && kill $(cat .rustfs.pid) 2>/dev/null && rm .rustfs.pid || true
    
    # Backup cleanup - more specific to avoid self-kill
    pkill -9 -u $(whoami) -f "./bin/rustfs" 2>/dev/null || true
    pkill -9 -u $(whoami) -f "python3 -m http.server 8888" 2>/dev/null || true
    pkill -9 -u $(whoami) -f "python3 -m http.server 8886" 2>/dev/null || true
    pkill -9 -u $(whoami) -f "python3 -m http.server 8887" 2>/dev/null || true
    pkill -9 -u $(whoami) -f "node scripts/proxy.js" 2>/dev/null || true

    echo "Removing temporary data..."
    rm -rf "$DATA_DIR" "$LOG_FILE" "*_web.log" "rustfs_startup.log" "proxy.log" ".proxy.pid" ".rustfs.pid" ".social_web.pid" ".banky_web.pid" 2>/dev/null || true
    rm -rf "demo-runtime" 2>/dev/null || true

    RESET_CONFIG="{
    \"endpoint\": \"http://127.0.0.1:$RUSTFS_PORT\",
    \"region\": \"rustfs\",
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
}

case "$1" in
    start) dev ;;
    stop) stop ;;
    *) echo "Usage: $0 {start|stop}"; exit 1 ;;
esac
