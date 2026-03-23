# SovereignS3nc Garage S3 Setup Guide

[Garage](https://garagehq.network/) is a lightweight, distributed S3-compatible storage engine designed for self-hosting. It is the recommended choice for SovereignS3nc if you want to run your own decentralized storage infrastructure.

## 1. Why Garage for SovereignS3nc?
- **Self-Hosting**: Easily run it on low-power hardware (like Raspberry Pis or small VPS nodes).
- **Native Quotas**: Unlike standard S3, Garage allows you to set hard limits on bucket size and object counts directly via the CLI.
- **Distributed by Default**: Seamlessly scales from one node to many across different regions.

## 2. Prerequisites
- [Garage Binary](https://garagehq.network/download.html) installed and running.
- Basic familiarity with the `garage` CLI.

## 3. Quick Setup using Helper Script
If you have `garage` in your path (or in `./bin/garage`), you can use the automated setup script:

```bash
chmod +x Setup/GARAGE/setup.sh
./Setup/GARAGE/setup.sh [bucket-name] [max-size-gb]
```

**What this script does:**
1. Generates a new S3 Key Pair.
2. Creates the target Bucket.
3. Grants the new Key ownership of the Bucket.
4. Sets a **Hard Storage Quota** (e.g., 5GB).

## 4. Manual Configuration

### Step A: Key Creation
```bash
garage key create my-sov-key
```

### Step B: Bucket Creation and Access
```bash
garage bucket create my-sov-bucket
garage bucket allow my-sov-bucket --read --write --owner --key <ACCESS_KEY_ID>
```

### Step C: Native Quotas (Anti-DoS)
Garage provides excellent protection against storage-based DoS attacks. You can limit a bucket to 5GB and 10,000 objects:
```bash
garage bucket set-quotas --max-size 5G --max-objects 10000 my-sov-bucket
```

## 5. Connecting SovereignS3nc to Garage

When initializing the library, use the following configuration pattern:

```typescript
const sovereign = new SovereignS3nc({
  s3: {
    region: 'garage',
    endpoint: 'http://your-garage-server:3900', // Default Garage S3 port
    credentials: {
      accessKeyId: '...',
      secretAccessKey: '...'
    },
    bucketName: 'my-sov-bucket',
    forcePathStyle: true // Mandatory for Garage
  },
  // ... rest of config
});
```

## 6. Security Note: CORS
For web-based applications, ensure your Garage node is configured to allow CORS requests. You can do this by running:
```bash
# This is a sample command, actual CORS configuration in Garage 
# is typically done via an front-end proxy (like Nginx) 
# or by configuring the Garage S3 API directly.
```
*(Refer to the [Garage CORS Documentation](https://garagehq.network/documentation/manual/administration/s3-api/#cors) for advanced settings.)*
