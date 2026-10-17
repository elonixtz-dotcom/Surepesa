import express, { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { KycDocumentType } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { presignGet, putObject } from '../lib/storage';
import { requireAuth } from '../middleware/auth';

export const kycRouter = Router();
kycRouter.use(requireAuth);

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

const submissionSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  dateOfBirth: z.coerce.date().optional(),
  idType: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID']),
  idNumber: z.string().trim().min(4).max(40),
});

async function loadOwnSubmission(userId: string, id: string) {
  const submission = await prisma.kycSubmission.findUnique({ where: { id }, include: { documents: true } });
  if (!submission || submission.userId !== userId) {
    throw new AppError('KYC_SUBMISSION_NOT_FOUND', 'KYC submission not found', 404);
  }
  return submission;
}

/** Starts a KYC submission; documents are uploaded to it afterwards. */
kycRouter.post('/submissions', async (req, res) => {
  const input = submissionSchema.parse(req.body);
  const user = req.user!;
  if (user.kycStatus === 'APPROVED') throw new AppError('KYC_ALREADY_APPROVED', 'Your identity is already verified', 409);
  if (user.kycStatus === 'PENDING') throw new AppError('KYC_ALREADY_PENDING', 'A verification is already under review', 409);

  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.kycSubmission.create({ data: { ...input, userId: user.id, status: 'PENDING' } });
    await tx.user.update({ where: { id: user.id }, data: { kycStatus: 'PENDING' } });
    return created;
  });
  res.status(201).json(submission);
});

/**
 * Uploads one document as the raw request body, e.g.
 *   PUT /v1/kyc/submissions/:id/documents/NATIONAL_ID   (Content-Type: image/jpeg)
 * The file goes to the private bucket; only its key and checksum are stored in Postgres.
 */
kycRouter.put(
  '/submissions/:id/documents/:type',
  express.raw({ type: Object.keys(ALLOWED_TYPES), limit: MAX_DOCUMENT_BYTES }),
  async (req, res) => {
    const type = z.nativeEnum(KycDocumentType).parse(req.params.type);
    const submission = await loadOwnSubmission(req.user!.id, String(req.params.id));
    if (submission.status !== 'PENDING') {
      throw new AppError('KYC_SUBMISSION_CLOSED', 'This submission has already been reviewed', 409);
    }
    const mimeType = req.headers['content-type']?.split(';')[0] ?? '';
    const extension = ALLOWED_TYPES[mimeType];
    if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError('INVALID_DOCUMENT', 'Upload a JPEG, PNG or PDF file up to 5 MB');
    }

    const body: Buffer = req.body;
    const storageKey = `users/${req.user!.id}/kyc/${submission.id}/${type.toLowerCase()}-${randomUUID()}.${extension}`;
    await putObject(env.KYC_BUCKET, storageKey, body, mimeType);

    const document = await prisma.kycDocument.create({
      data: {
        submissionId: submission.id,
        type,
        storageKey,
        mimeType,
        sizeBytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      },
    });
    res.status(201).json({ id: document.id, type: document.type, sizeBytes: document.sizeBytes, sha256: document.sha256 });
  },
);

/** The user's own submission, with 5-minute presigned links to their documents. */
kycRouter.get('/submissions/:id', async (req, res) => {
  const submission = await loadOwnSubmission(req.user!.id, String(req.params.id));
  const documents = await Promise.all(
    submission.documents.map(async (d) => ({
      id: d.id,
      type: d.type,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      url: await presignGet(env.KYC_BUCKET, d.storageKey),
    })),
  );
  res.json({ ...submission, documents });
});
