#!/bin/bash

# Create IAM Policy for S3 individual file size limit (1MB)
if [ -z "$1" ]; then
  echo "Usage: ./create-iam-policy.sh [bucket-name]"
  exit 1
fi

BUCKET_NAME=$1
POLICY_NAME="SovereignS3nc-1MB-Limit"

echo "Creating IAM Policy: $POLICY_NAME for bucket: $BUCKET_NAME..."

cat <<EOF > 1mb-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowFullS3AccessToBucket",
            "Effect": "Allow",
            "Action": "s3:*",
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME",
                "arn:aws:s3:::$BUCKET_NAME/*"
            ]
        },
        {
            "Sid": "DenyLargeUploads",
            "Effect": "Deny",
            "Action": "s3:PutObject",
            "Resource": "arn:aws:s3:::$BUCKET_NAME/*",
            "Condition": {
                "NumericGreaterThan": {
                    "s3:content-length": 1048576
                }
            }
        }
    ]
}
EOF

aws iam create-policy --policy-name $POLICY_NAME --policy-document file://1mb-policy.json
rm 1mb-policy.json

echo "Policy created successfully. Please attach it to your IAM User or Role."
