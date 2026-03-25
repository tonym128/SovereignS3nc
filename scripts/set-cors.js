const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

async function main() {
    const [endpoint, region, accessKeyId, secretAccessKey, bucketName] = process.argv.slice(2);
    
    console.log(`Setting CORS for bucket: ${bucketName} at ${endpoint}`);
    
    const client = new S3Client({
        endpoint: endpoint,
        region: region,
        credentials: {
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey
        },
        forcePathStyle: true
    });

    const corsConfig = {
        Bucket: bucketName,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedHeaders: [
                        "*",
                        "Authorization",
                        "Content-Type",
                        "X-Amz-Content-Sha256",
                        "X-Amz-Date",
                        "X-Amz-User-Agent",
                        "X-Amz-Meta-Hash",
                        "x-amz-meta-hash",
                        "Metadata",
                        "If-None-Match",
                        "If-Modified-Since",
                        "Range",
                        "Origin",
                        "Accept",
                        "x-amz-id-2",
                        "x-amz-request-id",
                        "x-amz-checksum-mode",
                        "x-amz-checksum-crc32",
                        "x-amz-checksum-crc32c",
                        "x-amz-checksum-sha1",
                        "x-amz-checksum-sha256",
                        "x-amz-sdk-checksum-algorithm",
                        "amz-sdk-invocation-id",
                        "amz-sdk-request"
                    ],
                    AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS"],
                    AllowedOrigins: ["*"],
                    ExposeHeaders: [
                        "ETag", 
                        "x-amz-meta-hash", 
                        "x-amz-id-2", 
                        "x-amz-request-id",
                        "Content-Length",
                        "Content-Type",
                        "x-amz-checksum-mode",
                        "x-amz-checksum-crc32",
                        "x-amz-checksum-crc32c",
                        "x-amz-checksum-sha1",
                        "x-amz-checksum-sha256"
                    ],
                    MaxAgeSeconds: 3000
                }
            ]
        }
    };

    try {
        await client.send(new PutBucketCorsCommand(corsConfig));
        console.log("CORS configuration applied successfully.");
    } catch (e) {
        console.error("Failed to apply CORS:", e.message);
        process.exit(1);
    }
}

main();
