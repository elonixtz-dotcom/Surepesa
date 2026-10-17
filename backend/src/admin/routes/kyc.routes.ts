import { Router } from 'express';
import { KycStatus } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { presignGet } from '../../lib/storage';
import { audit } from '../audit';
import { requirePermission } from '../auth';
import { displayName, pageParams } from '../present';

/** KYC review queue for Compliance / System Controller. Document links are 5-minute presigned URLs. */
export const kycReviewRouter = Router();
kycReviewRouter.use('/kyc', requirePermission('kyc:review'));

const userSelect = {
  id: true,
  phoneNumber: true,
  email: true,
  createdAt: true,
  profile: { select: { firstName: true, lastName: true, dateOfBirth: true } },
} as const;

kycReviewRouter.get('/kyc', async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const status = z.nativeEnum(KycStatus).default('PENDING').parse(req.query.status || undefined);
  const where = { status };
  const [total, items] = await Promise.all([
    prisma.kycSubmission.count({ where }),
    prisma.kycSubmission.findMany({ relationLoadStrategy: 'join',
      where,
      skip,
      take,
      orderBy: { submittedAt: status === 'PENDING' ? 'asc' : 'desc' }, // oldest first while waiting
      include: { user: { select: userSelect }, _count: { select: { documents: true } } },
    }),
  ]);
  res.json({
    page,
    pageSize,
    total,
    items: items.map((k) => ({
      id: k.id,
      status: k.status,
      fullName: k.fullName,
      idType: k.idType,
      idNumber: k.idNumber,
      documents: k._count.documents,
      customer: k.user ? { id: k.user.id, name: displayName(k.user), phoneNumber: k.user.phoneNumber } : null,
      submittedAt: k.submittedAt,
    })),
  });
});

kycReviewRouter.get('/kyc/:id', async (req, res) => {
  const k = await prisma.kycSubmission.findUnique({ relationLoadStrategy: 'join',
    where: { id: String(req.params.id) },
    include: { user: { select: userSelect }, documents: true, reviewedBy: { select: { fullName: true } } },
  });
  if (!k) throw new AppError('KYC_NOT_FOUND', 'Submission not found', 404);
  await audit({ actorId: req.admin!.id, action: 'KYC_VIEWED', entityType: 'KycSubmission', entityId: k.id, ipAddress: req.ip });

  res.json({
    id: k.id,
    status: k.status,
    fullName: k.fullName,
    dateOfBirth: k.dateOfBirth,
    idType: k.idType,
    idNumber: k.idNumber,
    submittedAt: k.submittedAt,
    reviewedAt: k.reviewedAt,
    reviewedBy: k.reviewedBy?.fullName ?? null,
    rejectionReason: k.rejectionReason,
    customer: k.user
      ? { id: k.user.id, name: displayName(k.user), phoneNumber: k.user.phoneNumber, email: k.user.email, profileDateOfBirth: k.user.profile?.dateOfBirth, joinedAt: k.user.createdAt }
      : null,
    documents: await Promise.all(
      k.documents.map(async (d) => ({
        id: d.id,
        type: d.type,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        url: await presignGet(env.KYC_BUCKET, d.storageKey),
      })),
    ),
  });
});

async function decide(id: string, adminId: string, decision: 'APPROVED' | 'REJECTED', reason?: string) {
  return prisma.$transaction(async (tx) => {
    const k = await tx.kycSubmission.findUnique({ where: { id } });
    if (!k) throw new AppError('KYC_NOT_FOUND', 'Submission not found', 404);
    if (k.status !== 'PENDING') throw new AppError('ALREADY_REVIEWED', `Submission is already ${k.status.toLowerCase()}`, 409);

    const updated = await tx.kycSubmission.update({
      where: { id },
      data: { status: decision, reviewedById: adminId, reviewedAt: new Date(), rejectionReason: reason ?? null },
    });
    if (k.userId) await tx.user.update({ where: { id: k.userId }, data: { kycStatus: decision } });
    if (k.businessId) await tx.business.update({ where: { id: k.businessId }, data: { kycStatus: decision } });
    await audit(
      { actorId: adminId, action: decision === 'APPROVED' ? 'KYC_APPROVED' : 'KYC_REJECTED', entityType: 'KycSubmission', entityId: id, before: { status: k.status }, after: { status: decision, reason } },
      tx,
    );
    return updated;
  });
}

kycReviewRouter.post('/kyc/:id/approve', async (req, res) => {
  res.json(await decide(String(req.params.id), req.admin!.id, 'APPROVED'));
});

kycReviewRouter.post('/kyc/:id/reject', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
  res.json(await decide(String(req.params.id), req.admin!.id, 'REJECTED', reason));
});
