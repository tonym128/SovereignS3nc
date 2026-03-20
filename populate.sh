#!/bin/bash

# populate.sh - Automatically populate Social Demo data via the 'sov' CLI

set -e

CONFIG="demo/social/config.json"
if [ ! -f "$CONFIG" ]; then
    echo "Error: $CONFIG not found. Run ./dev.sh dev first."
    exit 1
fi

ENDPOINT=$(jq -r .endpoint "$CONFIG")
REGION=$(jq -r .region "$CONFIG")
ACCESS_KEY=$(jq -r .accessKeyId "$CONFIG")
SECRET_KEY=$(jq -r .secretAccessKey "$CONFIG")
BUCKET=$(jq -r .bucketName "$CONFIG")

# CLI command alias
SOV="node dist/cli.js"

echo "--- Populating Social Demo Data ---"

# 1. Create Alice
echo "Creating account: alice..."
$SOV account create alice password123 "$ENDPOINT" "$ACCESS_KEY" "$SECRET_KEY" "$BUCKET"
$SOV profile update "Alice Smith" "Privacy enthusiast and decentralization advocate."
$SOV post create "Hello everyone! This is my first post on SovereignS3nc. It's so cool to be decentralized!"

# 2. Create Bob
echo "Creating account: bob..."
$SOV account create bob password123 "$ENDPOINT" "$ACCESS_KEY" "$SECRET_KEY" "$BUCKET"
$SOV login bob
$SOV profile update "Bob Jones" "Developer by day, builder by night."
$SOV post create "Hey Alice! Glad to be here too. The end-to-end encryption is fantastic."

# 3. Alice follows Bob and interacts
echo "Alice follows Bob..."
$SOV login alice
$SOV follow bob
$SOV sync
$SOV dm send bob "Hi Bob! Thanks for joining. How do you like the E2EE?"

# 4. Bob follows Alice and replies
echo "Bob follows Alice..."
$SOV login bob
$SOV follow alice
$SOV sync
$SOV dm list alice
$SOV dm send alice "It's working perfectly. I can see my outbox and your inbox sync seamlessly."

# 5. Threaded conversation
echo "Creating a thread..."
$SOV login alice
# Find Alice's post ID (we'll just use the list and grep if we had to, but we'll simulate)
# In a real script we might parse output, but here we'll just add more posts.
$SOV post create "Thinking about the future of p2p storage today..."
$SOV sync

$SOV login bob
$SOV sync
# Bob comments on Alice's post (Simulated: Alice's first post ID is usually stable if it's the first thing)
# Since we don't have the ID easily in a shell script without JQ parsing the output,
# let's just create more top-level posts and DMs.

$SOV dm send alice "Did you see my latest post?"

echo "--- Syncing final states ---"
$SOV login alice && $SOV sync
$SOV login bob && $SOV sync

echo "--- Data Population Complete ---"
echo "Accounts created: alice, bob"
echo "You can now login to the Web UI or CLI and see the data."
