#!/bin/bash

# Helper to create an OCI bucket with S3 compatibility features
if [ -z "$1" ]; then
  echo "Usage: ./create-bucket.sh [bucket-name] [compartment-id]"
  exit 1
fi

BUCKET_NAME=$1
COMPARTMENT_ID=$2
NAMESPACE=$(oci os ns get --query "data" --output text)

echo "Creating OCI Bucket: $BUCKET_NAME in Namespace: $NAMESPACE..."

# Create bucket with versioning and encryption (default enabled)
oci os bucket create \
    --name "$BUCKET_NAME" \
    --compartment-id "$COMPARTMENT_ID" \
    --versioning Enabled \
    --public-access-type NoPublicAccess

echo "------------------------------------------------"
echo "Bucket created: $BUCKET_NAME"
echo "Your OCI S3 Endpoint will be:"
echo "https://${NAMESPACE}.compat.objectstorage.$(oci config get --query 'region' --output text).oraclecloud.com"
echo "------------------------------------------------"
