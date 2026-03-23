# SovereignS3nc AWS Setup Guide

This guide provides instructions for deploying SovereignS3nc on **Amazon S3** with robust security, DoS protection, and cost management.

## 1. Prerequisites
- [AWS CLI](https://aws.amazon.com/cli/) installed and configured with appropriate permissions.
- An existing S3 Bucket (or create one using `aws s3 mb s3://your-bucket-name`).

## 2. Security: Enforce 1MB File Limit
To prevent DoS attacks where an attacker tries to upload massive files, you should enforce a 1MB limit at the IAM level.

**Run the helper script:**
```bash
chmod +x Setup/AWS/create-iam-policy.sh
./Setup/AWS/create-iam-policy.sh [your-bucket-name]
```
Attach the generated `SovereignS3nc-1MB-Limit` policy to the IAM user whose credentials you provide to the SovereignS3nc library.

## 3. Cost Management: The Budget Circuit Breaker
Since S3 is pay-as-you-go, an attacker could potentially drain your funds by uploading millions of 1MB files. We handle this by setting a monthly budget that triggers a Lambda "Circuit Breaker" to lock the bucket.

### Step A: Deploy the Circuit Breaker Lambda
This script sets up an IAM Role, Lambda function, and SNS Topic.
```bash
chmod +x Setup/AWS/deploy-lambda-circuit-breaker.sh
./Setup/AWS/deploy-lambda-circuit-breaker.sh [your-bucket-name] [aws-region]
```
**Take note of the SNS Topic ARN printed at the end.**

### Step B: Create the AWS Budget Alert
1. Go to **AWS Budgets Console** -> **Create Budget**.
2. Select **Cost Budget** and set your monthly limit (e.g., $5.00).
3. Under **Configure Alerts**:
   - Threshold: **100% of budgeted amount**.
   - Select **SNS Topic** and choose the topic created in Step A (`SovereignS3nc-Budget-Alerts`).
4. Complete the budget creation.

**When your budget limit is reached, AWS will send an SNS notification to the Lambda, which will immediately attach a "Deny All Writes" policy to your bucket.**

## 4. Recovery
If your bucket is locked due to a budget alert, you can unlock it by deleting the bucket policy:
```bash
aws s3api delete-bucket-policy --bucket [your-bucket-name]
```
*(Remember to increase your budget limit first to avoid it being immediately re-locked!)*

## 5. Performance Throttling
For high-traffic production environments, consider placing a **CloudFront** distribution in front of your S3 bucket. CloudFront provides:
- **AWS Shield Standard** (Automatic Layer 3/4 DoS protection).
- **AWS WAF Integration** (Rate-limiting by IP address).
- **Global Caching** (Reduced latency and S3 request costs).
