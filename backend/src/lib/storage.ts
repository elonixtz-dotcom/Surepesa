import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

/**
 * Neon Object Storage (S3-compatible). Credentials, endpoint and region come from the
 * standard AWS_* env vars; Neon requires path-style addressing.
 *
 * KYC documents live in a private bucket. Postgres stores only the object key; clients get
 * short-lived presigned URLs, never a permanent link.
 */
export const s3 = new S3Client({ forcePathStyle: true });

export async function putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'no-store' }),
  );
}

export function presignGet(bucket: string, key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
}

export async function checkStorage(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.KYC_BUCKET }));
    return true;
  } catch {
    return false;
  }
}
