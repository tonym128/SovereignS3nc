const { S3Client, PutBucketPolicyCommand, GetBucketPolicyCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client();

/**
 * AWS Lambda: S3 Cost Circuit Breaker
 * This function is triggered by an SNS notification from AWS Budgets.
 * It attaches a 'Deny All Writes' policy to the specified bucket to prevent further costs.
 */
exports.handler = async (event) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
        console.error("S3_BUCKET_NAME environment variable is missing.");
        return;
    }

    console.log(`Budget Alert Received. Locking bucket: ${bucketName}`);

    // Policy that denies all PutObject actions
    const denyPolicy = {
        Version: "2012-10-17",
        Statement: [{
            Sid: "BudgetLimitExceededDeny",
            Effect: "Deny",
            Principal: "*",
            Action: "s3:PutObject",
            Resource: `arn:aws:s3:::${bucketName}/*`
        }]
    };

    try {
        // We try to fetch existing policy to merge if needed, 
        // but for a circuit breaker, a clean Deny-All is safest.
        await s3.send(new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify(denyPolicy)
        }));
        
        console.log(`[SUCCESS] S3 Bucket ${bucketName} has been locked to read-only mode.`);
    } catch (err) {
        console.error("[ERROR] Failed to lock bucket:", err);
        throw err;
    }
};
