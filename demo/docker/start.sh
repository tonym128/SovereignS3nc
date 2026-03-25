#!/bin/sh

# start.sh - Entrypoint for the Social Demo Docker container

# 1. Update the social demo config to point to the rustfs service
# NOTE: The browser will need to reach RustFS. 
# If running locally with Docker Compose, 'localhost:9000' is used.
echo "Updating config.json to point to rustfs:9000..."
cat <<EOF > /app/demo/social/config.json
{
    "endpoint": "http://localhost:9000",
    "region": "rustfs",
    "accessKeyId": "user-key",
    "secretAccessKey": "user-secret-123",
    "bucketName": "sovereign-demo"
}
EOF

# 2. Start a simple web server for the Social Demo
echo "Starting Social Demo Web Server on port 8888..."
cd /app/demo/social && npx http-server -p 8888 -a 0.0.0.0
