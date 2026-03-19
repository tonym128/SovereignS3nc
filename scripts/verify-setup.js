const { S3Client, GetBucketCorsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

async function main() {
    const [endpoint, region, accessKeyId, secretAccessKey, bucketName] = process.argv.slice(2);
    
    console.log(`Verifying setup for bucket: ${bucketName} at ${endpoint}`);
    
    const client = new S3Client({
        endpoint: endpoint,
        region: region,
        credentials: {
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey
        },
        forcePathStyle: true
    });

    try {
        await client.send(new HeadBucketCommand({ Bucket: bucketName }));
        console.log("Bucket exists and is accessible.");

        const cors = await client.send(new GetBucketCorsCommand({ Bucket: bucketName }));
        console.log("Current CORS Configuration:");
        console.log(JSON.stringify(cors.CORSRules, null, 2));
    } catch (e) {
        console.error("Verification failed:", e.message);
        if (e.$metadata) console.error("Status Code:", e.$metadata.httpStatusCode);
    }
}

main();
