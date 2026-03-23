#!/bin/bash

# Deploy the S3 Circuit Breaker Lambda
if [ -z "$1" ]; then
  echo "Usage: ./deploy-lambda-circuit-breaker.sh [bucket-name] [region]"
  exit 1
fi

BUCKET_NAME=$1
REGION=${2:-us-east-1}
ROLE_NAME="SovereignS3nc-CircuitBreaker-Role"
FUNCTION_NAME="SovereignS3nc-Budget-Lock"

echo "Creating IAM Role for Lambda..."
cat <<EOF > trust-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

ROLE_ARN=$(aws iam create-role --role-name $ROLE_NAME --assume-role-policy-document file://trust-policy.json --query 'Role.Arn' --output text)
rm trust-policy.json

echo "Attaching S3 Policy to Role..."
cat <<EOF > s3-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutBucketPolicy",
                "s3:GetBucketPolicy"
            ],
            "Resource": "arn:aws:s3:::$BUCKET_NAME"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:log:*::*"
        }
    ]
}
EOF

aws iam put-role-policy --role-name $ROLE_NAME --policy-name S3Policy --policy-document file://s3-policy.json
rm s3-policy.json

echo "Packaging Lambda..."
mkdir -p build
cp Setup/AWS/lambda/index.js build/
cd build && zip -r function.zip . && cd ..

echo "Deploying Lambda function: $FUNCTION_NAME..."
# Give AWS a moment to propagate the role
sleep 10
FUNCTION_ARN=$(aws lambda create-function --function-name $FUNCTION_NAME \
    --zip-file fileb://build/function.zip --handler index.handler --runtime nodejs20.x \
    --role $ROLE_ARN --region $REGION \
    --environment "Variables={S3_BUCKET_NAME=$BUCKET_NAME}" \
    --query 'FunctionArn' --output text)

echo "Lambda deployed successfully. ARN: $FUNCTION_ARN"

echo "Creating SNS Topic for Budget Alerts..."
TOPIC_ARN=$(aws sns create-topic --name SovereignS3nc-Budget-Alerts --query 'TopicArn' --output text)

echo "Subscribing Lambda to SNS Topic..."
aws sns subscribe --topic-arn $TOPIC_ARN --protocol lambda --notification-endpoint $FUNCTION_ARN

echo "Adding Lambda Permission for SNS..."
aws lambda add-permission --function-name $FUNCTION_NAME --statement-id SNSInvoke --action lambda:InvokeFunction --principal sns.amazonaws.com --source-arn $TOPIC_ARN

echo "------------------------------------------------"
echo "Setup Complete!"
echo "SNS Topic ARN: $TOPIC_ARN"
echo "1. Use this SNS Topic ARN when creating your AWS Budget Alert."
echo "2. When budget threshold is hit, Lambda will lock your bucket."
echo "------------------------------------------------"
rm -rf build
