#!/bin/bash

# Setup Garage S3 for SovereignS3nc
# This script assumes 'garage' is in your PATH or in ./bin/garage

GARAGE_BIN=${GARAGE_BIN:-./bin/garage}

if [ -z "$1" ]; then
  echo "Usage: ./setup.sh [bucket-name] [max-size-gb]"
  echo "Example: ./setup.sh sovereign-bucket 5"
  exit 1
fi

BUCKET_NAME=$1
MAX_SIZE=${2:-5}
KEY_NAME="sov-key-$(date +%s)"

echo "Creating S3 Key: $KEY_NAME..."
# Create key and capture the Access Key and Secret Key
KEY_INFO=$($GARAGE_BIN key create $KEY_NAME)
ACCESS_KEY=$(echo "$KEY_INFO" | grep "Access key ID:" | awk '{print $4}')
SECRET_KEY=$(echo "$KEY_INFO" | grep "Secret access key:" | awk '{print $4}')

echo "Creating Bucket: $BUCKET_NAME..."
$GARAGE_BIN bucket create $BUCKET_NAME

echo "Assigning Key to Bucket..."
$GARAGE_BIN bucket allow $BUCKET_NAME --read --write --owner --key $ACCESS_KEY

echo "Setting Quotas: ${MAX_SIZE}GB..."
$GARAGE_BIN bucket set-quotas --max-size "${MAX_SIZE}G" $BUCKET_NAME

echo "------------------------------------------------"
echo "Garage Setup Complete!"
echo "Bucket: $BUCKET_NAME"
echo "Access Key: $ACCESS_KEY"
echo "Secret Key: $SECRET_KEY"
echo "Region: garage"
echo "Endpoint: http://localhost:3900 (Default Garage Port)"
echo "------------------------------------------------"
echo "IMPORTANT: Save these credentials! They will not be shown again."
