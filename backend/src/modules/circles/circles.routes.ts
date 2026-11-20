import { Router } from 'express';
import { z } from 'zod';
import { Circle, CircleInvitation, CircleMember } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import {
  acceptInvitation,
  createCircle,
  createGoal,
  declineInvitation,
  getCircle,
  getProgress,
  getReport,
  inviteToCircle,
  leaveCircle,
  listCircles,
  listContributions,
  listMyInvitations,
  recordContribution,
  removeMember,
  setMemberRole,
  setReminderPreference,
  updateCircle,
} from './circles.service';

/**
 * Circles ★ (blueprint §8): /v1/circles
 *
 * Group goal/contribution tracking. Circles never hold or move money; confirmed vs
 * self-reported totals are always returned separately.
 */
export const circlesRouter = Router();
circlesRouter.use(requireAuth);

const phone = z.string().regex(/^\+255[67]\d{8}$/, 'Use the format +2557XXXXXXXX');
const amount = z.string().regex(/^[1-9]\d{0,17}$/, 'Enter a valid amount');

function presentCircle(circle: Circle, counts?: { members: number; contributions: number }) {
  return {
    id: circle.id,
    reference: circle.reference,
    name: circle.name,
    purpose: circle.purpose,
    type: circle.type,
    status: circle.status,
    currencyCode: circle.currencyCode,
    targetAmountMinor: circle.targetAmount?.toString() ?? null,
    targetDate: circle.targetDate,
    memberCount: counts?.members,
    contributionCount: counts?.contributions,
    createdAt: circle.createdAt,
  };
}

function presentMember(m: CircleMember & { user?: { phoneNumber: string | null; profile: { firstName: string; lastName: string } | null } }) {
  return {
    memberId: m.id,
    userId: m.userId,
    role: m.role,
    status: m.status,
    reminders: m.reminders,
    joinedAt: m.joinedAt,
    name: m.user?.profile ? `${m.user.profile.firstName} ${m.user.profile.lastName}` : null,
    phone: m.user?.phoneNumber ?? null,
  };
}

function presentInvitation(inv: CircleInvitation) {
  return {
    token: inv.token,
    circleId: inv.circleId,
    inviteePhone: inv.inviteePhone,
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  };
}

circlesRouter.post('/', async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(80),
      purpose: z.string().trim().max(500).optional(),
      type: z.enum(['FAMILY', 'STUDENT', 'VIKOBA', 'FRIENDS', 'CUSTOM']),
      currencyCode: z.string().regex(/^[A-Z]{3}$/).default('TZS'),
      targetAmount: amount.optional(),
      targetDate: z.string().date().optional(),
    })
    .parse(req.body);
  const circle = await createCircle({
    ownerId: req.user!.id,
    name: input.name,
    purpose: input.purpose,
    type: input.type,
    currencyCode: input.currencyCode,
    targetAmount: input.targetAmount ? BigInt(input.targetAmount) : undefined,
    targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00.000Z`) : undefined,
  });
  res.status(201).json(presentCircle(circle, { members: 1, contributions: 0 }));
});

circlesRouter.get('/', async (req, res) => {
  const memberships = await listCircles(req.user!.id);
  res.json({
    items: memberships.map((m) => ({
      ...presentCircle(m.circle, { members: m.circle._count.members, contributions: m.circle._count.contributions }),
      myRole: m.role,
    })),
  });
});

circlesRouter.get('/invitations', async (req, res) => {
  const invitations = await listMyInvitations(req.user!.id);
  res.json({
    items: invitations.map((inv) => ({
      ...presentInvitation(inv),
      circle: { id: inv.circle.id, name: inv.circle.name, type: inv.circle.type, reference: inv.circle.reference },
      inviterName: inv.inviter.profile ? `${inv.inviter.profile.firstName} ${inv.inviter.profile.lastName}` : null,
    })),
  });
});

circlesRouter.post('/invitations/:token/accept', async (req, res) => {
  const member = await acceptInvitation(req.user!.id, String(req.params.token));
  res.json({ circleId: member.circleId, role: member.role, status: member.status });
});

circlesRouter.post('/invitations/:token/decline', async (req, res) => {
  await declineInvitation(req.user!.id, String(req.params.token));
  res.json({ status: 'DECLINED' });
});

circlesRouter.get('/:id', async (req, res) => {
  const circle = await getCircle(req.user!.id, String(req.params.id));
  res.json({
    ...presentCircle(circle),
    members: circle.members.map(presentMember),
    goals: circle.goals.map((g) => ({
      id: g.id,
      title: g.title,
      targetAmountMinor: g.targetAmount.toString(),
      dueDate: g.dueDate,
      status: g.status,
      expectedPerMemberMinor: g.expectedPerMember?.toString() ?? null,
      frequency: g.frequency,
    })),
    pendingInvitations: circle.invitations.map(presentInvitation),
  });
});

circlesRouter.patch('/:id', async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      purpose: z.string().trim().max(500).nullable().optional(),
      targetAmount: amount.nullable().optional(),
      targetDate: z.string().date().nullable().optional(),
      archive: z.literal(true).optional(),
    })
    .parse(req.body);
  const circle = await updateCircle(req.user!.id, String(req.params.id), {
    name: input.name,
    purpose: input.purpose === null ? undefined : input.purpose,
    targetAmount: input.targetAmount === undefined ? undefined : input.targetAmount === null ? null : BigInt(input.targetAmount),
    targetDate: input.targetDate === undefined ? undefined : input.targetDate === null ? null : new Date(`${input.targetDate}T00:00:00.000Z`),
    archive: input.archive,
  });
  res.json(presentCircle(circle));
});

circlesRouter.post('/:id/invitations', async (req, res) => {
  const input = z.object({ inviteePhone: phone }).parse(req.body);
  const inv = await inviteToCircle(req.user!.id, String(req.params.id), input.inviteePhone);
  res.status(201).json(presentInvitation(inv));
});

circlesRouter.post('/:id/members/:userId/role', async (req, res) => {
  const input = z.object({ role: z.enum(['ADMIN', 'MEMBER']) }).parse(req.body);
  const member = await setMemberRole(req.user!.id, String(req.params.id), String(req.params.userId), input.role);
  res.json(presentMember(member));
});

circlesRouter.post('/:id/members/:userId/remove', async (req, res) => {
  await removeMember(req.user!.id, String(req.params.id), String(req.params.userId));
  res.json({ status: 'REMOVED' });
});

circlesRouter.post('/:id/leave', async (req, res) => {
  await leaveCircle(req.user!.id, String(req.params.id));
  res.json({ status: 'LEFT' });
});

circlesRouter.post('/:id/reminders', async (req, res) => {
  const input = z.object({ enabled: z.boolean() }).parse(req.body);
  await setReminderPreference(req.user!.id, String(req.params.id), input.enabled);
  res.json({ reminders: input.enabled });
});

circlesRouter.post('/:id/goals', async (req, res) => {
  const input = z
    .object({
      title: z.string().trim().min(2).max(120),
      targetAmount: amount,
      dueDate: z.string().date().optional(),
      expectedPerMember: amount.optional(),
      frequency: z.enum(['ONCE', 'WEEKLY', 'MONTHLY']).optional(),
    })
    .parse(req.body);
  const goal = await createGoal(req.user!.id, String(req.params.id), {
    title: input.title,
    targetAmount: BigInt(input.targetAmount),
    dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : undefined,
    expectedPerMember: input.expectedPerMember ? BigInt(input.expectedPerMember) : undefined,
    frequency: input.frequency,
  });
  res.status(201).json({
    id: goal.id,
    title: goal.title,
    targetAmountMinor: goal.targetAmount.toString(),
    dueDate: goal.dueDate,
    status: goal.status,
    expectedPerMemberMinor: goal.expectedPerMember?.toString() ?? null,
    frequency: goal.frequency,
  });
});

circlesRouter.post('/:id/contributions', async (req, res) => {
  const input = z
    .object({
      goalId: z.string().uuid().optional(),
      amount,
      note: z.string().trim().max(240).optional(),
      externalRef: z.string().trim().max(120).optional(),
      transactionId: z.string().uuid().optional(),
    })
    .parse(req.body);
  const record = await recordContribution(req.user!.id, String(req.params.id), {
    goalId: input.goalId,
    amount: BigInt(input.amount),
    note: input.note,
    externalRef: input.externalRef,
    transactionId: input.transactionId,
  });
  res.status(201).json({
    id: record.id,
    goalId: record.goalId,
    amountMinor: record.amount.toString(),
    currencyCode: record.currencyCode,
    source: record.source,
    verification: record.verification,
    recordedAt: record.recordedAt,
  });
});

circlesRouter.get('/:id/contributions', async (req, res) => {
  const records = await listContributions(req.user!.id, String(req.params.id));
  res.json({
    items: records.map((r) => ({
      id: r.id,
      goalId: r.goalId,
      goalTitle: r.goal?.title ?? null,
      amountMinor: r.amount.toString(),
      currencyCode: r.currencyCode,
      source: r.source,
      verification: r.verification,
      note: r.note,
      externalRef: r.externalRef,
      recordedAt: r.recordedAt,
      member: presentMember(r.member),
    })),
  });
});

circlesRouter.get('/:id/progress', async (req, res) => {
  const progress = await getProgress(req.user!.id, String(req.params.id));
  // BigInt -> string for JSON (the app sets a replacer, but keep amounts explicit).
  res.json({
    ...progress,
    targetAmount: progress.targetAmount?.toString() ?? null,
    confirmedTotal: progress.confirmedTotal.toString(),
    unverifiedTotal: progress.unverifiedTotal.toString(),
    goals: progress.goals.map((g) => ({ ...g, targetAmount: g.targetAmount.toString(), confirmed: g.confirmed.toString(), unverified: g.unverified.toString() })),
    members: progress.members.map((m) => ({ ...m, confirmed: m.confirmed.toString(), unverified: m.unverified.toString() })),
  });
});

circlesRouter.get('/:id/report', async (req, res) => {
  const report = await getReport(req.user!.id, String(req.params.id));
  res.json(report);
});
