# SovereignS3nc AWS Setup Guide

This guide provides instructions for deploying SovereignS3nc on **Amazon S3** with robust security, DoS protection, and cost management.

## 1. Prerequisites
- [AWS CLI](https://aws.amazon.com/cli/) installed and configured with appropriate permissions.
- An existing S3 Bucket (or create one using `aws s3 mb s3://your-bucket-name`).

## 2. IAM Security: Admin vs. User Keys
SovereignS3nc relies on IAM policies to enforce data isolation between users and admins.

### Step A: The Admin Policy
Create an IAM user for yourself and attach a policy that allows full access to the `${appId}/` prefix. This user will have access to the Admin Dashboard.

### Step B: The User Policy (Enforce 1MB Limit & Isolation)
For regular users, you should use a policy that restricts them to their own `${userId}` prefix and enforces a 1MB file limit.

**Run the helper script:**
```bash
chmod +x Setup/AWS/create-iam-policy.sh
./Setup/AWS/create-iam-policy.sh [your-bucket-name]
```
*Note: The generated policy `SovereignS3nc-1MB-Limit` uses the `s3:content-length` condition to prevent massive uploads.*

### Step C: Production isolation
For a multi-user production environment, we recommend using **IAM Policy Variables** (like `${aws:username}`) to create a single policy that automatically scopes every user to their own folder. See `Setup/GENERIC_S3_POLICY.json` for the logic.

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
