const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

// Configuration matches start.sh defaults
const ENDPOINT = process.env.S3_ENDPOINT || 'http://127.0.0.1:3900';
const REGION = process.env.S3_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'sovereign-demo';

const ACCESS_KEY = process.env.ACCESS_KEY;
const SECRET_KEY = process.env.SECRET_KEY;

if (!ACCESS_KEY || !SECRET_KEY) {
    console.error("Error: ACCESS_KEY and SECRET_KEY environment variables are required.");
    process.exit(1);
}

const client = new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY
    },
    forcePathStyle: true // Required for Garage/MinIO
});

const corsParams = {
    Bucket: BUCKET,
    CORSConfiguration: {
        CORSRules: [
            {
                AllowedHeaders: ["*"],
                AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS"],
                AllowedOrigins: ["*"], // For demo purposes, allow all. In prod, restrict this.
                ExposeHeaders: ["ETag", "Content-Type", "Content-Length", "Last-Modified", "Date", "Server", "Connection", "Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"],
                MaxAgeSeconds: 3000
            }
        ]
    }
};

const run = async () => {
    console.log(`Applying CORS configuration to bucket '${BUCKET}' at ${ENDPOINT}...`);
    try {
        await client.send(new PutBucketCorsCommand(corsParams));
        console.log("Successfully applied CORS configuration.");
    } catch (err) {
        console.error("Failed to apply CORS configuration:", err);
        process.exit(1);
    }
};

run();
