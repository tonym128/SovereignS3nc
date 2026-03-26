# SovereignS3nc Production Docker Setup

This directory contains a production-ready Docker Compose template for SovereignS3nc.

## Components
1. **RustFS**: S3-compatible storage engine for user data.
2. **PeerJS Signaling Server**: For WebRTC handshakes between peers.
3. **Nginx**: Reverse proxy with TLS termination.
4. **RustFS Setup**: Automated initialization of buckets, IAM policies, and CORS.

## Prerequisites
- Docker and Docker Compose installed.
- A domain name (or use `localhost` for testing).

## Quick Start

### 1. Prepare TLS Certificates
Nginx is configured to look for certificates in `Setup/certs/`. For production, use real certificates (e.g., from Let's Encrypt). For testing, you can generate self-signed certificates:

```bash
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

### 2. Configure Environment (Optional)
You can customize the default keys and bucket name by setting environment variables or editing the `docker-compose.prod.yml` file.

### 3. Launch Services
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 4. Verify Setup
- **RustFS API**: `https://localhost/`
- **RustFS Console**: `https://localhost/console/`
- **PeerJS Signaling**: `https://localhost/sov-mesh`

The `rustfs-setup` container will run once to create the bucket, set up IAM users (`admin-key` and `user-key`), and apply CORS policies. You can check its logs:
```bash
docker-compose -f docker-compose.prod.yml logs rustfs-setup
```

## Nginx Configuration
The Nginx configuration (`nginx.conf`) handles:
- Redirecting HTTP (80) to HTTPS (443).
- Proxying WebRTC signaling traffic to PeerJS with WebSocket support.
- Proxying S3 API requests to RustFS.
- Terminating TLS.

## RustFS Customization
Data is persisted in the `rustfs_data` Docker volume. You can find the data on your host machine using `docker volume inspect`.

To customize IAM policies, modify `Setup/init-rustfs.sh` before running the setup.
