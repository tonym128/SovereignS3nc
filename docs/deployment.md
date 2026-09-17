# SovereignS3nc Deployment Guide

SovereignS3nc is designed to be compatible with any S3-compliant object storage provider. This guide provides detailed configuration examples and identifies known nuances for popular providers like **MinIO**, **Cloudflare R2**, and **DigitalOcean Spaces**.

## General S3 Configuration

Most providers require the following base configuration in your `SovereignConfig`:

```typescript
const config: SovereignConfig = {
  s3: {
    region: 'us-east-1', // Default or provider-specific
    endpoint: 'https://...', // Custom endpoint URL
    credentials: {
      accessKeyId: '...',
      secretAccessKey: '...'
    },
    bucketName: 'my-sovereign-data',
    forcePathStyle: true // Recommended for most custom S3 providers
  },
  paths: {
    appId: 'my-app',
    userId: 'user-123',
    storeId: 'main'
  }
};
```

---

## 1. MinIO (Self-Hosted)

MinIO is the preferred choice for self-hosted sovereign data.

### Configuration
- **Endpoint:** Usually `http://localhost:9000` or your server's IP/domain.
- **Region:** Any string (e.g., `us-east-1`).
- **forcePathStyle:** **Required** (`true`) unless you have configured `MINIO_DOMAIN` for virtual-host style addressing.

### Nuances
- **Metadata Limit:** User-defined metadata is limited to **2 KB** (sum of keys and values).
- **ETag Casing:** Standard `ETag` header is returned, but some proxies (like Nginx) might normalize it to `Etag`. SovereignS3nc handles this automatically.
- **Multipart ETags:** For files uploaded in parts, the ETag will follow the `hash-N` format.

---

## 2. Cloudflare R2

Cloudflare R2 is excellent for low-latency global access with zero egress fees.

### Configuration
- **Endpoint:** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- **Region:** Must be set to **`auto`**.
- **forcePathStyle:** Recommended `true` for standard API access.

### Nuances
- **Metadata Limit:** Supports up to **8 KB** of user-defined metadata.
- **Unicode Metadata:** R2 supports Unicode in metadata keys/values via RFC 2047 encoding.
- **Multipart ETags:** R2's ETag behavior for multipart uploads can deviate from standard MD5-based hashes; SovereignS3nc's internal `hash` metadata field mitigates this.
- **Public Buckets:** If using a Custom Domain for a public bucket, you may need to set `forcePathStyle: false`.

---

## 3. DigitalOcean Spaces

DigitalOcean Spaces provides a simple, cost-effective S3-compatible layer.

### Configuration
- **Endpoint:** `https://<REGION>.digitaloceanspaces.com` (e.g., `nyc3.digitaloceanspaces.com`).
- **Region:** The slug of your datacenter (e.g., `nyc3`, `ams3`).
- **forcePathStyle:** **Required** if your bucket name contains a dot (`.`), as wildcard SSL certificates will fail for virtual-host style subdomains. Recommended `true` for all cases.

### Nuances
- **Metadata Limit:** Hard limit of **2 KB** for user-defined metadata.
- **ETag Casing:** Some legacy implementations may return `Etag` instead of `ETag`.
- **CORS Requirements:** For browser-based applications, you **must** explicitly expose the `ETag` header in your bucket's CORS settings, or `If-None-Match` requests will fail.
- **Billing Nuance:** The minimum billable object size is **4 KiB**. Storing many tiny files (e.g., individual small logs) will be billed as if they were 4 KiB each.

---

## 4. Backblaze B2

Backblaze B2 offers affordable S3-compatible cloud storage with high durability.

### Configuration
- **Endpoint:** `https://s3.<REGION>.backblazeb2.com` (e.g., `s3.us-west-004.backblazeb2.com`).
- **Region:** The region slug assigned to your bucket (e.g., `us-west-004`).
- **forcePathStyle:** Recommended `true` or `false` (B2 supports virtual-host style for buckets without dots).
- **Credentials:** Create an Application Key in Backblaze B2 with Read and Write access to your specific bucket.

### Nuances
- **Metadata Limit:** Up to **2 KB** of user-defined metadata.
- **CORS Expose Headers:** When using SovereignS3nc in the browser, you **must** configure CORS rules in Backblaze B2 to expose `ETag`, `x-amz-meta-hash`, and `x-amz-meta-mtime`:
  ```json
  [
    {
      "corsRuleName": "sovereignS3ncWeb",
      "allowedOrigins": ["*"],
      "allowedOperations": ["s3_head", "s3_get", "s3_put", "s3_delete"],
      "allowedHeaders": ["*"],
      "exposeHeaders": ["ETag", "x-amz-meta-hash", "x-amz-meta-mtime", "x-amz-request-id"],
      "maxAgeSeconds": 3600
    }
  ]
  ```
- **ETags on Large Files:** B2 computes ETags differently on large multipart uploads. SovereignS3nc's client-side SHA-256 hash tracking avoids false sync triggers.

---

## Summary of Provider Quirks

| Provider | Metadata Limit | Recommended `forcePathStyle` | Region | Known Nuances |
| :--- | :--- | :--- | :--- | :--- |
| **AWS S3** | 2 KB | `false` | Standard (e.g. `us-east-1`) | Gold standard for compatibility. |
| **MinIO** | 2 KB | `true` | Any | Path-style is default. |
| **Cloudflare R2** | 8 KB | `true` | `auto` | Zero egress; Requires `auto` region. |
| **Backblaze B2** | 2 KB | `true` | Region Slug (`us-west-004`) | **Must expose `ETag` and metadata in CORS.** |
| **DO Spaces** | 2 KB | `true` | Data Center Slug | **Must expose ETag in CORS.** |
| **OCI** | 2 KB | `true` | Region Slug | Requires S3 Compatibility API keys. |

## Troubleshooting

### "Access Denied" or 403 Errors
- Ensure your IAM policy (or provider equivalent) allows `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, and `s3:ListBucket`.
- Check if your bucket is set to "Private". SovereignS3nc works best with private buckets using signed requests (credentials).

### "304 Not Modified" is not working
- This usually happens if the `ETag` header is not being returned to the browser due to CORS restrictions.
- **Fix:** In your S3 provider console, add `ETag` to the "Exposed Headers" list in the CORS configuration.

### ETag Mismatch
- If you are seeing sync loops, verify that your provider is not modifying the file on upload (e.g., auto-compressing or adding a BOM).
- Ensure you are not using "Multipart Upload" for very small files if your provider changes the ETag format significantly.
