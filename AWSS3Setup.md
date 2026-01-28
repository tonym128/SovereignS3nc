# AWS S3 Setup Guide for SovereignS3nc

This guide details the steps to create an AWS S3 bucket and configure an IAM user with the necessary credentials to use with **SovereignS3nc**.

## Prerequisites
- An active [AWS Account](https://aws.amazon.com/).
- Access to the AWS Management Console.

---

## Step 1: Create an S3 Bucket

1.  Log in to the **AWS Management Console** and navigate to **S3**.
2.  Click the orange **Create bucket** button.
3.  **Bucket Name**: Enter a globally unique name (e.g., `my-sovereign-data-2024`).
4.  **AWS Region**: Select the region closest to you (e.g., `us-east-1`).
5.  **Object Ownership**: Keep "ACLs disabled" (recommended).
6.  **Block Public Access settings**:
    - For a standard private setup (recommended), keep **Block all public access** CHECKED.
    - *Note: SovereignS3nc handles sharing via encrypted blobs and presigned URLs (if implemented) or direct IAM access. You typically do NOT need a public bucket.*
7.  **Bucket Versioning**: Optional (can be enabled for backup safety).
8.  **Default encryption**: Enable (SSE-S3 is fine).
9.  Click **Create bucket**.

---

## Step 2: Create a Permission Policy

Instead of giving full S3 access, we will create a policy restricted to just your new bucket.

1.  Navigate to the **IAM (Identity and Access Management)** console.
2.  On the left sidebar, click **Policies**.
3.  Click **Create policy**.
4.  Click the **JSON** tab and paste the following policy (replace `YOUR_BUCKET_NAME` with your actual bucket name):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllObjectActions",
            "Effect": "Allow",
            "Action": "s3:*Object",
            "Resource": [
                "arn:aws:s3:::YOUR_BUCKET_NAME/*"
            ]
        }
    ]
}
```

5.  Click **Next**.
6.  **Policy Name**: Enter a name like `SovereignS3ncAccessPolicy`.
7.  Click **Create policy**.

---

## Step 3: Create an IAM User

1.  In the IAM Console, click **Users** on the left sidebar.
2.  Click **Create user**.
3.  **User name**: Enter a name (e.g., `sovereign-client`).
4.  Click **Next**.
5.  **Permissions options**: Select **Attach policies directly**.
6.  In the search box, type `SovereignS3ncAccessPolicy` (the name you created in Step 2).
7.  Check the box next to your policy.
8.  Click **Next**, then **Create user**.

---

## Step 4: Generate Access Keys

1.  Click on the newly created user (e.g., `sovereign-client`) in the Users list.
2.  Click on the **Security credentials** tab.
3.  Scroll down to the **Access keys** section and click **Create access key**.
4.  Select **Application running outside AWS**.
5.  Click **Next**, then **Create access key**.
6.  **IMPORTANT**: Copy the **Access Key ID** and **Secret Access Key**.
    - This is the *only* time you will be shown the Secret Access Key. Store it securely (e.g., in a password manager).

---

## Step 5: Configure CORS (Cross-Origin Resource Sharing)

If you are running SovereignS3nc apps from a browser (e.g., `localhost` or a hosted web app), you **must** configure CORS on the bucket.

1.  Go back to the **S3 Console** and click on your bucket.
2.  Click the **Permissions** tab.
3.  Scroll down to the **Cross-origin resource sharing (CORS)** section and click **Edit**.
4.  Paste the following JSON:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "PUT",
            "POST",
            "DELETE",
            "GET",
            "HEAD"
        ],
        "AllowedOrigins": [
            "*"
        ],
        "ExposeHeaders": [
            "ETag",
            "x-amz-meta-custom-header"
        ]
    }
]
```
*Note: For better security in production, replace `"*"` in `AllowedOrigins` with the specific domain of your application (e.g., `https://myapp.com`). For `localhost` development, `*` is convenient.*

5.  Click **Save changes**.

---

## Summary

You now have everything needed to configure your SovereignS3nc client:

- **Endpoint**: (Leave blank for AWS, or use specific regional endpoint like `https://s3.us-east-1.amazonaws.com`)
- **Bucket Name**: `YOUR_BUCKET_NAME`
- **Region**: `YOUR_REGION` (e.g., `us-east-1`)
- **Access Key ID**: The key from Step 4.
- **Secret Access Key**: The secret from Step 4.
