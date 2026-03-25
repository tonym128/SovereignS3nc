# SovereignS3nc RustFS Setup Guide

[RustFS](https://rustfs.com/) is a high-performance, single-binary S3-compatible storage engine. It is the recommended choice for SovereignS3nc development and self-hosted production due to its native support for advanced IAM features and low resource footprint.

## 1. Prerequisites
- [RustFS Binary](https://rustfs.com/downloads) downloaded and in your PATH.
- [RustFS CLI (`rc`)](https://github.com/rustfs/cli) installed for administrative tasks.

## 2. Start the Server
For development, you can start RustFS with a local data directory:
```bash
rustfs server \
    --address "127.0.0.1:9000" \
    --access-key "root-key" \
    --secret-key "root-secret" \
    --console-enable \
    ./rustfs_data
```

## 3. Configuration with `rc`
Use the RustFS CLI to configure your environment.

### Step A: Set Alias
```bash
rc alias set local "http://127.0.0.1:9000" "root-key" "root-secret"
```

### Step B: Create the Bucket
```bash
rc mb local/sovereign-demo
```

### Step C: Configure CORS
Modern browsers require explicit CORS headers. Since RustFS is a backend service, you must apply a CORS policy to your bucket.
```bash
# Use the helper script provided in the repo
node scripts/set-cors.js "http://127.0.0.1:9000" "rustfs" "root-key" "root-secret" "sovereign-demo"
```

## 4. IAM Security: Admin vs. User Keys
SovereignS3nc uses IAM policies to isolate user data and enable moderation features.

### Step A: Admin Key
Create an admin user who can perform moderation tasks (deleting content, banning users).
```bash
rc admin user add local "admin-key" "admin-secret-123"
```
Attach a "Full Access" policy to this user for the specific bucket.

### Step B: User Key
Create a shared key for regular users. SovereignS3nc uses client-side prefixing to keep users isolated even if they share an S3 key, but for production, you should use a policy that enforces this isolation.
```bash
rc admin user add local "user-key" "user-secret-123"
```

### Step C: Apply Isolation Policy
Create a `user-policy.json` that restricts users to their own prefixes and allows them to post reports to the admin.
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowAppAccess",
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": [
                "arn:aws:s3:::sovereign-demo/*/user-*/*",
                "arn:aws:s3:::sovereign-demo/*/global/*"
            ]
        },
        {
            "Sid": "AllowAdminReporting",
            "Effect": "Allow",
            "Action": ["s3:PutObject"],
            "Resource": ["arn:aws:s3:::sovereign-demo/*/admin/data/reports/*"]
        }
    ]
}
```
Apply it:
```bash
rc admin policy create local sov-user user-policy.json
rc admin policy attach local sov-user --user "user-key"
```

## 5. Development Script
The repository includes a `dev.sh` script that automates the entire RustFS setup (downloading binaries, starting the server, configuring keys/policies/CORS).
```bash
./dev.sh dev
```
This is the fastest way to get a fully functional SovereignS3nc environment running locally.
