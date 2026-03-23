# SovereignS3nc OCI (Oracle Cloud Infrastructure) Setup Guide

SovereignS3nc is fully compatible with **OCI Object Storage** using its Amazon S3 Compatibility API. This guide walks you through the setup and provides tools for security and cost control.

## 1. Prerequisites
- An [OCI Account](https://www.oracle.com/cloud/).
- [OCI CLI](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm) installed and configured.
- A **Compartment** created to isolate your SovereignS3nc resources.

## 2. Obtain S3 Credentials (Customer Secret Keys)
SovereignS3nc uses "Customer Secret Keys" to authenticate with OCI:
1. Open the OCI Console.
2. Go to **Identity & Security** -> **Users** -> Select your user.
3. Click **Customer Secret Keys** in the sidebar.
4. Click **Generate Secret Key**.
5. Copy the **Access Key ID** and the **Secret Key**.

## 3. Identify your Endpoint
OCI S3-compatible endpoints follow this pattern:
`https://{namespace}.compat.objectstorage.{region}.oraclecloud.com`

**How to find your Namespace:**
```bash
oci os ns get --query "data" --output text
```

## 4. Cost Management: Compartment Quotas
Unlike AWS, OCI provides **Hard Quotas** that stop you from overspending. This is the most effective way to prevent DoS-related cost spikes.

**Run the helper script:**
```bash
chmod +x Setup/OCI/setup-compartment-quota.sh
./Setup/OCI/setup-compartment-quota.sh [compartment-ocid] [max-gb]
```
*(Example: Set a 5GB hard limit for all storage in your compartment.)*

## 5. Security: Pre-Authenticated Requests (PAR)
If you do not want to expose S3 credentials in your client application, SovereignS3nc supports OCI **Pre-Authenticated Requests (PAR)**. 

A PAR provides a temporary, time-limited URL that allows the library to upload/download objects without needing `accessKeyId` or `secretAccessKey`. 

**Create a PAR for a Bucket:**
```bash
oci os preauth-request create \
    --name "SovereignS3nc-Session" \
    --access-type AnyObjectWrite \
    --bucket-name [bucket-name] \
    --time-expires 2026-12-31T00:00:00Z
```
You can then pass the generated URL to SovereignS3nc via the `ociParUrl` configuration field.

## 6. Budget Alerts
OCI also supports standard budget alerts:
1. Go to **Billing & Cost Management** -> **Budgets**.
2. Create a budget for your Compartment.
3. Set an alert at 80% and 100% of your limit.
