/**
 * upload-to-rustfs.js
 * Recursively uploads a local directory to a RustFS S3 bucket path.
 * Sets a bucket policy allowing anonymous GetObject on the uploaded prefix.
 *
 * Usage:
 *   node scripts/upload-to-rustfs.js <endpoint> <adminKey> <adminSecret> <bucket> <localDir> <s3Prefix>
 *
 * Example:
 *   node scripts/upload-to-rustfs.js http://127.0.0.1:9100 admin-key admin-secret-123 sovereign-demo demo/social website
 */

const {
    S3Client,
    PutObjectCommand,
    PutBucketPolicyCommand,
} = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.svg':  'image/svg+xml',
    '.wasm': 'application/wasm',
    '.map':  'application/json',
    '.txt':  'text/plain',
    '.webmanifest': 'application/manifest+json',
};

function getMime(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function walkDir(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(walkDir(full));
        } else {
            results.push(full);
        }
    }
    return results;
}

async function main() {
    const [endpoint, adminKey, adminSecret, bucket, localDir, s3Prefix] = process.argv.slice(2);

    if (!endpoint || !adminKey || !adminSecret || !bucket || !localDir || !s3Prefix) {
        console.error('Usage: node upload-to-rustfs.js <endpoint> <adminKey> <adminSecret> <bucket> <localDir> <s3Prefix>');
        process.exit(1);
    }

    const client = new S3Client({
        endpoint,
        region: 'rustfs',
        credentials: { accessKeyId: adminKey, secretAccessKey: adminSecret },
        forcePathStyle: true,
    });

    // ── Set bucket policy allowing public read on the website prefix ───────────
    const policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
            Sid: 'PublicReadWebsite',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/${s3Prefix}/*`],
        }],
    });

    try {
        await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }));
        console.log(`✅ Bucket policy set: anonymous GetObject on ${bucket}/${s3Prefix}/*`);
    } catch (e) {
        console.warn(`⚠️  Could not set bucket policy (may not be supported): ${e.message}`);
        console.warn('   Files will still be uploaded; access may require credentials.');
    }

    // ── Upload all files ───────────────────────────────────────────────────────
    const files = walkDir(localDir);
    let uploaded = 0;
    let failed = 0;

    for (const filePath of files) {
        const relative = path.relative(localDir, filePath);
        const key = `${s3Prefix}/${relative.replace(/\\/g, '/')}`;
        const body = fs.readFileSync(filePath);
        const contentType = getMime(filePath);

        try {
            await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
            }));
            process.stdout.write(`  ↑ ${key}\n`);
            uploaded++;
        } catch (e) {
            console.error(`  ✗ FAILED ${key}: ${e.message}`);
            failed++;
        }
    }

    console.log(`\n✅ Upload complete: ${uploaded} files uploaded, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
