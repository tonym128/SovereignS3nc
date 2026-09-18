#!/bin/sh

# init-rustfs.sh - Initialize RustFS for production use
# This script is designed to run inside a Docker container.

set -e

ENDPOINT=${RUSTFS_ENDPOINT:-http://rustfs:9000}
ROOT_KEY=${RUSTFS_ROOT_KEY:-rustfsroot}
ROOT_SECRET=${RUSTFS_ROOT_SECRET:-rustfsrootsecret}
BUCKET=${BUCKET_NAME:-sovereign-demo}
ADMIN_ACCESS=${ADMIN_ACCESS:-admin-key}
ADMIN_SECRET=${ADMIN_SECRET:-admin-secret-123}
USER_ACCESS=${USER_ACCESS:-user-key}
USER_SECRET=${USER_SECRET:-user-secret-123}

echo "--- Waiting for RustFS at $ENDPOINT ---"
until wget -qO- "$ENDPOINT" > /dev/null 2>&1; do
  echo "RustFS not ready yet, sleeping..."
  sleep 2
done

echo "--- Downloading RustFS CLI (rc) ---"
wget -q https://github.com/rustfs/cli/releases/download/v0.1.36/rustfs-cli-linux-amd64-v0.1.36.tar.gz -O rc.tar.gz
tar -xzf rc.tar.gz
mv rc /usr/local/bin/rc
chmod +x /usr/local/bin/rc
rm rc.tar.gz

echo "--- Configuring RustFS ---"
rc alias set local "$ENDPOINT" "$ROOT_KEY" "$ROOT_SECRET"

# Create Bucket
echo "Creating bucket: $BUCKET"
rc mb "local/$BUCKET" || true

# Create Admin User
echo "Creating admin user: $ADMIN_ACCESS"
rc admin user add local "$ADMIN_ACCESS" "$ADMIN_SECRET" || true

# Admin Policy
cat <<EOF > admin-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": [
                "arn:aws:s3:::$BUCKET",
                "arn:aws:s3:::$BUCKET/*"
            ]
        }
    ]
}
EOF
rc admin policy create local sov-admin admin-policy.json || true
rc admin policy attach local sov-admin --user "$ADMIN_ACCESS" || true

# Create Regular User
echo "Creating regular user: $USER_ACCESS"
rc admin user add local "$USER_ACCESS" "$USER_SECRET" || true

# User Isolation Policy
cat <<EOF > user-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowListBucket",
            "Effect": "Allow",
            "Action": ["s3:ListBucket"],
            "Resource": ["arn:aws:s3:::$BUCKET"],
            "Condition": {
                "StringLike": {
                    "s3:prefix": [
                        "*/user-*/*",
                        "*/global/*"
                    ]
                },
                "StringNotLike": {
                    "s3:prefix": [
                        "*/admin/*"
                    ]
                }
            }
        },
        {
            "Sid": "AllowAppAccess",
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": [
                "arn:aws:s3:::$BUCKET/*/user-*/*",
                "arn:aws:s3:::$BUCKET/*/global/*",
                "arn:aws:s3:::$BUCKET/*/*/social/*"
            ]
        },
        {
            "Sid": "DenyAdminData",
            "Effect": "Deny",
            "Action": ["s3:*"],
            "Resource": [
                "arn:aws:s3:::$BUCKET/*/admin/data/*"
            ]
        },
        {
            "Sid": "AllowAdminReporting",
            "Effect": "Allow",
            "Action": ["s3:PutObject"],
            "Resource": ["arn:aws:s3:::$BUCKET/*/admin/reports/*"]
        }
    ]
}
EOF
rc admin policy create local sov-user user-policy.json || true
rc admin policy attach local sov-user --user "$USER_ACCESS" || true

echo "--- Configuring CORS ---"
# Use the existing script. We need to install dependencies first.
npm install @aws-sdk/client-s3 --no-save
node scripts/set-cors.js "$ENDPOINT" "rustfs" "$ADMIN_ACCESS" "$ADMIN_SECRET" "$BUCKET"

echo "------------------------------------------------"
echo "RustFS Production Initialization Complete!"
echo "Bucket: $BUCKET"
echo "Admin Access Key: $ADMIN_ACCESS"
echo "User Access Key: $USER_ACCESS"
echo "------------------------------------------------"
