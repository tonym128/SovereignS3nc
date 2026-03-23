#!/bin/bash

# Setup OCI Compartment Quotas for Object Storage
if [ -z "$2" ]; then
  echo "Usage: ./setup-compartment-quota.sh [compartment-id] [max-gb]"
  exit 1
fi

COMPARTMENT_ID=$1
MAX_GB=$2
QUOTA_NAME="SovereignS3nc-Quota"

echo "Creating OCI Quota: $QUOTA_NAME for compartment: $COMPARTMENT_ID..."

# OCI Quota statements to limit total storage and object count
# Note: These are 'hard' limits enforced by OCI.
STATEMENT1="set objectstorage quota standard-object-size to ${MAX_GB}GB in compartment id ${COMPARTMENT_ID}"
STATEMENT2="set objectstorage quota standard-object-count to 10000 in compartment id ${COMPARTMENT_ID}"

oci limits quota create \
    --compartment-id $COMPARTMENT_ID \
    --name "$QUOTA_NAME" \
    --description "Hard limits for SovereignS3nc storage" \
    --statements "[\"$STATEMENT1\", \"$STATEMENT2\"]"

echo "------------------------------------------------"
echo "Quota created successfully!"
echo "Total Storage: ${MAX_GB}GB"
echo "Total Objects: 10,000"
echo "------------------------------------------------"
