import { Router } from 'express';
import { z } from 'zod';
import { CircleMemberRole, CircleMemberStatus, CircleType } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

export const circlesRouter = Router();
circlesRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  type: z.nativeEnum(CircleType),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default('TZS'),
  targetAmountMinor: z.string().regex(/^[1-9]\\d{0,17}$/).optional(),
  targetDate: z.string().date().optional(),
});
const inviteSchema = z.object({ userId: z.string().uuid() });
const contributionSchema = z.object({
  amountMinor: z.string().regex(/^[1-9]\\d{0,17}$/),
  note: z.string().trim().max(240).optional(),
  externalReference: z.string().trim().max(120).optional(),
});

async function requireCircleMember(circleId: string, userId: string) {
  const member = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
    include: { circle: true },
  });
  if (!member || member.status !== 'ACTIVE') {
    throw new AppError('CIRCLE_NOT_FOUND', 'Circle not found', 404);
  }
  return member;
}

circlesRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  const userId = req.user!.id;
  const circle = await prisma.$transaction(async (tx) => {
    const created = await tx.circle.create({
      data: {
        ownerUserId: userId,
        name: input.name,
        description: input.description,
        type: input.type,
        currencyCode: input.currencyCode,
        targetAmount: input.targetAmountMinor ? BigInt(input.targetAmountMinor) : null,
        targetDate: input.targetDate ? new Date(input.targetDate + 'T00:00:00.000Z') : null,
      },
    });
    await tx.circleMember.create({
      data: { circleId: created.id, userId, role: CircleMemberRole.OWNER, status: CircleMemberStatus.ACTIVE, joinedAt: new Date() },
    });
    return created;
  });
  res.status(201).json({ ...circle, targetAmountMinor: circle.targetAmount?.toString() ?? null, targetAmount: undefined });
});

circlesRouter.get('/', async (req, res) => {
  const memberships = await prisma.circleMember.findMany({
    where: { userId: req.user!.id, status: 'ACTIVE' },
    include: { circle: { include: { _count: { select: { members: true, contributions: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items: memberships.map((m) => ({
    id: m.circle.id, name: m.circle.name, description: m.circle.description, type: m.circle.type,
    status: m.circle.status, currencyCode: m.circle.currencyCode,
    targetAmountMinor: m.circle.targetAmount?.toString() ?? null, targetDate: m.circle.targetDate,
    role: m.role, memberCount: m.circle._count.members, contributionCount: m.circle._count.contributions,
    createdAt: m.circle.createdAt,
  })) });
});

circlesRouter.get('/invitations/pending', async (req, res) => {
  const invitations = await prisma.circleMember.findMany({
    where: { userId: req.user!.id, status: 'INVITED' },
    include: { circle: { select: { id: true, name: true, type: true, ownerUserId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items: invitations.map((i) => ({ id: i.id, circle: i.circle, invitedAt: i.createdAt })) });
});
import { Router } from 'express';
import { z } from 'zod';
import { CircleMemberRole, CircleMemberStatus, CircleType } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

export const circlesRouter = Router();
circlesRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  type: z.nativeEnum(CircleType),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default('TZS'),
  targetAmountMinor: z.string().regex(/^[1-9]\\d{0,17}$/).optional(),
  targetDate: z.string().date().optional(),
});
const inviteSchema = z.object({ userId: z.string().uuid() });
const contributionSchema = z.object({
  amountMinor: z.string().regex(/^[1-9]\\d{0,17}$/),
  note: z.string().trim().max(240).optional(),
  externalReference: z.string().trim().max(120).optional(),
});

async function requireCircleMember(circleId: string, userId: string) {
  const member = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
    include: { circle: true },
  });
  if (!member || member.status !== 'ACTIVE') {
    throw new AppError('CIRCLE_NOT_FOUND', 'Circle not found', 404);
  }
  return member;
}

circlesRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  const userId = req.user!.id;
  const circle = await prisma.$transaction(async (tx) => {
    const created = await tx.circle.create({
      data: {
        ownerUserId: userId,
        name: input.name,
        description: input.description,
        type: input.type,
        currencyCode: input.currencyCode,
        targetAmount: input.targetAmountMinor ? BigInt(input.targetAmountMinor) : null,
        targetDate: input.targetDate ? new Date(input.targetDate + 'T00:00:00.000Z') : null,
      },
    });
    await tx.circleMember.create({
      data: { circleId: created.id, userId, role: CircleMemberRole.OWNER, status: CircleMemberStatus.ACTIVE, joinedAt: new Date() },
    });
    return created;
  });
  res.status(201).json({ ...circle, targetAmountMinor: circle.targetAmount?.toString() ?? null, targetAmount: undefined });
});

circlesRouter.get('/', async (req, res) => {
  const memberships = await prisma.circleMember.findMany({
    where: { userId: req.user!.id, status: 'ACTIVE' },
    include: { circle: { include: { _count: { select: { members: true, contributions: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items: memberships.map((m) => ({
    id: m.circle.id, name: m.circle.name, description: m.circle.description, type: m.circle.type,
    status: m.circle.status, currencyCode: m.circle.currencyCode,
    targetAmountMinor: m.circle.targetAmount?.toString() ?? null, targetDate: m.circle.targetDate,
    role: m.role, memberCount: m.circle._count.members, contributionCount: m.circle._count.contributions,
    createdAt: m.circle.createdAt,
  })) });
});

circlesRouter.get('/:circleId', async (req, res) => {
  const circleId = String(req.params.circleId);
  const member = await requireCircleMember(circleId, req.user!.id);
  const [members, contributions] = await Promise.all([
    prisma.circleMember.findMany({
      where: { circleId, status: 'ACTIVE' },
      include: { user: { include: { profile: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.circleContribution.findMany({
      where: { circleId },
      orderBy: { contributionDate: 'desc' },
      take: 100,
    }),
  ]);
  res.json({
    id: member.circle.id, name: member.circle.name, description: member.circle.description,
    type: member.circle.type, status: member.circle.status, currencyCode: member.circle.currencyCode,
    targetAmountMinor: member.circle.targetAmount?.toString() ?? null, targetDate: member.circle.targetDate,
    role: member.role,
    members: members.map((m) => ({
      userId: m.userId, role: m.role,
      displayName: m.user.profile ? [m.user.profile.firstName, m.user.profile.lastName].join(' ') : 'SurePesa member',
      joinedAt: m.joinedAt,
    })),
    contributions: contributions.map((c) => ({
      id: c.id, userId: c.userId, amountMinor: c.amount.toString(), currencyCode: c.currencyCode,
      status: c.status, sourceType: c.sourceType, note: c.note, contributionDate: c.contributionDate,
    })),
  });
});

circlesRouter.post('/:circleId/invitations', async (req, res) => {
  const circleId = String(req.params.circleId);
  const input = inviteSchema.parse(req.body);
  const actor = await requireCircleMember(circleId, req.user!.id);
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
    throw new AppError('CIRCLE_FORBIDDEN', 'Only Circle owners and admins can invite members', 403);
  }
  if (input.userId === req.user!.id) throw new AppError('INVALID_INVITEE', 'You are already a Circle member');
  const invitee = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!invitee || invitee.status !== 'ACTIVE') throw new AppError('USER_NOT_FOUND', 'Active SurePesa user not found', 404);
  const existing = await prisma.circleMember.findUnique({ where: { circleId_userId: { circleId, userId: input.userId } } });
  if (existing?.status === 'ACTIVE' || existing?.status === 'INVITED') {
    throw new AppError('MEMBERSHIP_EXISTS', 'This user is already a member or has a pending invitation', 409);
  }
  const invitation = existing
    ? await prisma.circleMember.update({ where: { id: existing.id }, data: { status: 'INVITED', role: 'MEMBER', invitedByUserId: req.user!.id, joinedAt: null } })
    : await prisma.circleMember.create({ data: { circleId, userId: input.userId, invitedByUserId: req.user!.id, status: 'INVITED' } });
  res.status(201).json({ invitationId: invitation.id, circleId, userId: invitation.userId, status: invitation.status });
});


circlesRouter.get('/:circleId', async (req, res) => {
  const circleId = String(req.params.circleId);
  const member = await requireCircleMember(circleId, req.user!.id);
  const [members, contributions] = await Promise.all([
    prisma.circleMember.findMany({
      where: { circleId, status: 'ACTIVE' },
      include: { user: { include: { profile: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.circleContribution.findMany({
      where: { circleId },
      orderBy: { contributionDate: 'desc' },
      take: 100,
    }),
  ]);
  res.json({
    id: member.circle.id, name: member.circle.name, description: member.circle.description,
    type: member.circle.type, status: member.circle.status, currencyCode: member.circle.currencyCode,
    targetAmountMinor: member.circle.targetAmount?.toString() ?? null, targetDate: member.circle.targetDate,
    role: member.role,
    members: members.map((m) => ({
      userId: m.userId, role: m.role,
      displayName: m.user.profile ? [m.user.profile.firstName, m.user.profile.lastName].join(' ') : 'SurePesa member',
      joinedAt: m.joinedAt,
    })),
    contributions: contributions.map((c) => ({
      id: c.id, userId: c.userId, amountMinor: c.amount.toString(), currencyCode: c.currencyCode,
      status: c.status, sourceType: c.sourceType, note: c.note, contributionDate: c.contributionDate,
    })),
  });
});

circlesRouter.post('/:circleId/invitations', async (req, res) => {
  const circleId = String(req.params.circleId);
  const input = inviteSchema.parse(req.body);
  const actor = await requireCircleMember(circleId, req.user!.id);
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
    throw new AppError('CIRCLE_FORBIDDEN', 'Only Circle owners and admins can invite members', 403);
  }
  if (input.userId === req.user!.id) throw new AppError('INVALID_INVITEE', 'You are already a Circle member');
  const invitee = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!invitee || invitee.status !== 'ACTIVE') throw new AppError('USER_NOT_FOUND', 'Active SurePesa user not found', 404);
  const existing = await prisma.circleMember.findUnique({ where: { circleId_userId: { circleId, userId: input.userId } } });
  if (existing?.status === 'ACTIVE' || existing?.status === 'INVITED') {
    throw new AppError('MEMBERSHIP_EXISTS', 'This user is already a member or has a pending invitation', 409);
  }
  const invitation = existing
    ? await prisma.circleMember.update({ where: { id: existing.id }, data: { status: 'INVITED', role: 'MEMBER', invitedByUserId: req.user!.id, joinedAt: null } })
    : await prisma.circleMember.create({ data: { circleId, userId: input.userId, invitedByUserId: req.user!.id, status: 'INVITED' } });
  res.status(201).json({ invitationId: invitation.id, circleId, userId: invitation.userId, status: invitation.status });
});


circlesRouter.post('/:circleId/invitations/accept', async (req, res) => {
  const circleId = String(req.params.circleId);
  const invitation = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId: req.user!.id } },
  });
  if (!invitation || invitation.status !== 'INVITED') throw new AppError('INVITATION_NOT_FOUND', 'Pending invitation not found', 404);
  const updated = await prisma.circleMember.update({
    where: { id: invitation.id },
    data: { status: 'ACTIVE', joinedAt: new Date() },
  });
  res.json({ circleId, status: updated.status, joinedAt: updated.joinedAt });
});

circlesRouter.post('/:circleId/contributions', async (req, res) => {
  const circleId = String(req.params.circleId);
  const input = contributionSchema.parse(req.body);
  const member = await requireCircleMember(circleId, req.user!.id);
  if (member.circle.status !== 'ACTIVE') throw new AppError('CIRCLE_PAUSED', 'This Circle is not accepting contributions', 409);
  const contribution = await prisma.circleContribution.create({
    data: {
      circleId, userId: req.user!.id, amount: BigInt(input.amountMinor),
      currencyCode: member.circle.currencyCode, status: 'SELF_REPORTED', sourceType: 'MANUAL',
      externalReference: input.externalReference, note: input.note,
    },
  });
  res.status(201).json({
    id: contribution.id, circleId, amountMinor: contribution.amount.toString(),
    currencyCode: contribution.currencyCode, status: contribution.status,
    sourceType: contribution.sourceType, contributionDate: contribution.contributionDate,
  });
});


