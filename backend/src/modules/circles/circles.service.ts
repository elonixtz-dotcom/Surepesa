import {
  Circle,
  CircleGoal,
  CircleInvitation,
  CircleMember,
  ContributionRecord,
  Prisma,
} from '@prisma/client';
import { prisma, TX_OPTIONS } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { newCircleInviteToken, newCircleReference } from '../../lib/reference';

/**
 * CircleGoalMonitor (blueprint §8): Circles track goals and contributions around a shared
 * purpose. They are monitoring and coordination tools only — this module NEVER moves,
 * holds or controls members' money. A contribution is PROVIDER_CONFIRMED only when it is
 * backed by a completed SurePesa transaction executed by that member; everything else is
 * self-reported and stays UNVERIFIED.
 */

export const CIRCLE_INVITE_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

type Db = Prisma.TransactionClient | typeof prisma;

// ─────────────────────── helpers ───────────────────────

async function recordEvent(
  db: Db,
  circleId: string,
  action: string,
  actor: { type: 'USER' | 'SYSTEM'; id?: string | null },
  data?: Prisma.InputJsonValue,
): Promise<void> {
  await db.circleEvent.create({
    data: { circleId, action, actorType: actor.type, actorId: actor.id ?? null, data },
  });
}

async function loadCircle(id: string): Promise<Circle> {
  const circle = await prisma.circle.findUnique({ where: { id } });
  if (!circle) throw new AppError('CIRCLE_NOT_FOUND', 'Circle not found', 404);
  return circle;
}

/** Loads the caller's ACTIVE membership, or hides the circle's existence. */
async function requireMember(circleId: string, userId: string): Promise<CircleMember> {
  const member = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
  });
  if (!member || member.status !== 'ACTIVE') {
    throw new AppError('CIRCLE_NOT_FOUND', 'Circle not found', 404);
  }
  return member;
}

function requireOrganiser(member: CircleMember): void {
  if (member.role === 'MEMBER') {
    throw new AppError('CIRCLE_FORBIDDEN', 'Only the Circle owner or an admin can do this', 403);
  }
}

function assertActive(circle: Circle): void {
  if (circle.status !== 'ACTIVE') {
    throw new AppError('CIRCLE_ARCHIVED', 'This Circle is archived and read-only', 409);
  }
}

// ─────────────────────── lifecycle ───────────────────────

export interface CreateCircleInput {
  ownerId: string;
  name: string;
  purpose?: string;
  type: 'FAMILY' | 'STUDENT' | 'VIKOBA' | 'FRIENDS' | 'CUSTOM';
  currencyCode?: string;
  targetAmount?: bigint;
  targetDate?: Date;
}

export async function createCircle(input: CreateCircleInput): Promise<Circle> {
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: input.ownerId } });
  if (owner.status !== 'ACTIVE') throw new AppError('ACCOUNT_NOT_ACTIVE', 'Your account is not active', 403);

  return prisma.$transaction(async (tx) => {
    const circle = await tx.circle.create({
      data: {
        reference: newCircleReference(),
        ownerId: owner.id,
        name: input.name,
        purpose: input.purpose,
        type: input.type,
        currencyCode: input.currencyCode ?? 'TZS',
        targetAmount: input.targetAmount,
        targetDate: input.targetDate,
      },
    });
    await tx.circleMember.create({
      data: { circleId: circle.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await recordEvent(tx, circle.id, 'CREATED', { type: 'USER', id: owner.id }, { type: input.type });
    return circle;
  }, TX_OPTIONS);
}

export async function listCircles(userId: string) {
  const memberships = await prisma.circleMember.findMany({
    where: { userId, status: 'ACTIVE' },
    include: {
      circle: {
        include: { _count: { select: { members: { where: { status: 'ACTIVE' } }, contributions: true } } },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });
  return memberships;
}

export async function getCircle(userId: string, circleId: string) {
  await requireMember(circleId, userId);
  return prisma.circle.findUniqueOrThrow({
    where: { id: circleId },
    include: {
      members: { where: { status: 'ACTIVE' }, include: { user: { include: { profile: true } } } },
      goals: { orderBy: { createdAt: 'asc' } },
      invitations: { where: { status: 'PENDING' } },
    },
  });
}

export interface UpdateCircleInput {
  name?: string;
  purpose?: string;
  targetAmount?: bigint | null;
  targetDate?: Date | null;
  archive?: boolean;
}

export async function updateCircle(userId: string, circleId: string, input: UpdateCircleInput): Promise<Circle> {
  const circle = await loadCircle(circleId);
  const member = await requireMember(circleId, userId);
  requireOrganiser(member);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.circle.update({
      where: { id: circle.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        ...(input.targetAmount !== undefined ? { targetAmount: input.targetAmount } : {}),
        ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
        ...(input.archive ? { status: 'ARCHIVED' as const } : {}),
      },
    });
    await recordEvent(tx, circle.id, input.archive ? 'ARCHIVED' : 'UPDATED', { type: 'USER', id: userId });
    return row;
  }, TX_OPTIONS);
  return updated;
}

// ─────────────────────── invitations & members ───────────────────────

export async function inviteToCircle(
  userId: string,
  circleId: string,
  inviteePhone: string,
): Promise<CircleInvitation> {
  const circle = await loadCircle(circleId);
  assertActive(circle);
  const member = await requireMember(circleId, userId);
  requireOrganiser(member);

  const invitee = await prisma.user.findUnique({ where: { phoneNumber: inviteePhone } });
  if (!invitee || invitee.status !== 'ACTIVE') {
    throw new AppError('INVITEE_NOT_FOUND', 'No active SurePesa account uses this number', 404);
  }
  const alreadyMember = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId: invitee.id } },
  });
  if (alreadyMember && alreadyMember.status === 'ACTIVE') {
    throw new AppError('ALREADY_MEMBER', 'This person is already in the Circle', 409);
  }
  const pending = await prisma.circleInvitation.findFirst({
    where: { circleId, inviteeId: invitee.id, status: 'PENDING' },
  });
  if (pending) return pending; // re-asking returns the same invite, not a duplicate

  const invitation = await prisma.$transaction(async (tx) => {
    const inv = await tx.circleInvitation.create({
      data: {
        circleId,
        inviterId: userId,
        inviteeId: invitee.id,
        inviteePhone,
        token: newCircleInviteToken(),
        expiresAt: new Date(Date.now() + CIRCLE_INVITE_TTL_MS),
      },
    });
    await tx.notification.create({
      data: {
        userId: invitee.id,
        channel: 'IN_APP',
        title: 'Circle invitation',
        body: `You have been invited to join "${circle.name}".`,
        data: { circleId, invitationToken: inv.token },
      },
    });
    await recordEvent(tx, circleId, 'INVITATION_SENT', { type: 'USER', id: userId }, { inviteeId: invitee.id });
    return inv;
  }, TX_OPTIONS);
  return invitation;
}

export async function listMyInvitations(userId: string) {
  return prisma.circleInvitation.findMany({
    where: { inviteeId: userId, status: 'PENDING', expiresAt: { gt: new Date() } },
    include: { circle: true, inviter: { include: { profile: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function loadPendingInvitation(token: string, userId: string): Promise<CircleInvitation> {
  const inv = await prisma.circleInvitation.findUnique({ where: { token } });
  if (!inv || inv.inviteeId !== userId) {
    throw new AppError('INVITATION_NOT_FOUND', 'Invitation not found', 404);
  }
  if (inv.status !== 'PENDING') throw new AppError('INVITATION_USED', 'This invitation is no longer pending', 409);
  if (inv.expiresAt.getTime() <= Date.now()) {
    await prisma.circleInvitation.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
    throw new AppError('INVITATION_EXPIRED', 'This invitation has expired', 410);
  }
  return inv;
}

/** Accepting an invitation re-activates a past membership or creates a new one. */
export async function acceptInvitation(userId: string, token: string): Promise<CircleMember> {
  const inv = await loadPendingInvitation(token, userId);
  return prisma.$transaction(async (tx) => {
    await tx.circleInvitation.update({
      where: { id: inv.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
    const member = await tx.circleMember.upsert({
      where: { circleId_userId: { circleId: inv.circleId, userId } },
      create: { circleId: inv.circleId, userId, role: 'MEMBER', status: 'ACTIVE' },
      update: { status: 'ACTIVE', leftAt: null, role: 'MEMBER' },
    });
    await recordEvent(tx, inv.circleId, 'MEMBER_JOINED', { type: 'USER', id: userId });
    return member;
  }, TX_OPTIONS);
}

export async function declineInvitation(userId: string, token: string): Promise<void> {
  const inv = await loadPendingInvitation(token, userId);
  await prisma.$transaction(async (tx) => {
    await tx.circleInvitation.update({
      where: { id: inv.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    await recordEvent(tx, inv.circleId, 'INVITATION_DECLINED', { type: 'USER', id: userId });
  }, TX_OPTIONS);
}

export async function setMemberRole(
  actorUserId: string,
  circleId: string,
  targetUserId: string,
  role: 'ADMIN' | 'MEMBER',
): Promise<CircleMember> {
  await loadCircle(circleId);
  const actor = await requireMember(circleId, actorUserId);
  if (actor.role !== 'OWNER') {
    throw new AppError('CIRCLE_FORBIDDEN', 'Only the Circle owner can change roles', 403);
  }
  const target = await requireMember(circleId, targetUserId);
  if (target.role === 'OWNER') throw new AppError('CIRCLE_FORBIDDEN', 'The owner role cannot be changed', 403);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.circleMember.update({ where: { id: target.id }, data: { role } });
    await recordEvent(tx, circleId, 'ROLE_CHANGED', { type: 'USER', id: actorUserId }, { targetUserId, role });
    return row;
  }, TX_OPTIONS);
  return updated;
}

export async function leaveCircle(userId: string, circleId: string): Promise<void> {
  const member = await requireMember(circleId, userId);
  if (member.role === 'OWNER') {
    throw new AppError('OWNER_CANNOT_LEAVE', 'Transfer ownership or archive the Circle first', 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.circleMember.update({
      where: { id: member.id },
      data: { status: 'LEFT', leftAt: new Date() },
    });
    await recordEvent(tx, circleId, 'MEMBER_LEFT', { type: 'USER', id: userId });
  }, TX_OPTIONS);
}

export async function removeMember(actorUserId: string, circleId: string, targetUserId: string): Promise<void> {
  const actor = await requireMember(circleId, actorUserId);
  requireOrganiser(actor);
  const target = await requireMember(circleId, targetUserId);
  if (target.role === 'OWNER') throw new AppError('CIRCLE_FORBIDDEN', 'The owner cannot be removed', 403);
  if (target.role === 'ADMIN' && actor.role !== 'OWNER') {
    throw new AppError('CIRCLE_FORBIDDEN', 'Only the owner can remove an admin', 403);
  }
  await prisma.$transaction(async (tx) => {
    await tx.circleMember.update({ where: { id: target.id }, data: { status: 'REMOVED', leftAt: new Date() } });
    await recordEvent(tx, circleId, 'MEMBER_REMOVED', { type: 'USER', id: actorUserId }, { targetUserId });
  }, TX_OPTIONS);
}

export async function setReminderPreference(userId: string, circleId: string, enabled: boolean): Promise<void> {
  const member = await requireMember(circleId, userId);
  await prisma.circleMember.update({ where: { id: member.id }, data: { reminders: enabled } });
}

// ─────────────────────── goals ───────────────────────

export interface CreateGoalInput {
  title: string;
  targetAmount: bigint;
  dueDate?: Date;
  expectedPerMember?: bigint;
  frequency?: 'ONCE' | 'WEEKLY' | 'MONTHLY';
}

export async function createGoal(userId: string, circleId: string, input: CreateGoalInput): Promise<CircleGoal> {
  const circle = await loadCircle(circleId);
  assertActive(circle);
  const member = await requireMember(circleId, userId);
  requireOrganiser(member);
  if (input.targetAmount <= 0n) throw new AppError('INVALID_AMOUNT', 'The goal target must be greater than zero', 400);
  return prisma.$transaction(async (tx) => {
    const goal = await tx.circleGoal.create({
      data: {
        circleId,
        title: input.title,
        targetAmount: input.targetAmount,
        dueDate: input.dueDate,
        expectedPerMember: input.expectedPerMember,
        frequency: input.frequency,
      },
    });
    await recordEvent(tx, circleId, 'GOAL_CREATED', { type: 'USER', id: userId }, { goalId: goal.id });
    return goal;
  }, TX_OPTIONS);
}

// ─────────────────────── contributions ───────────────────────

export interface RecordContributionInput {
  goalId?: string;
  amount: bigint;
  note?: string;
  externalRef?: string;
  /** Optional: a completed transaction executed by this member, for PROVIDER_CONFIRMED. */
  transactionId?: string;
}

export async function recordContribution(
  userId: string,
  circleId: string,
  input: RecordContributionInput,
): Promise<ContributionRecord> {
  const circle = await loadCircle(circleId);
  assertActive(circle);
  const member = await requireMember(circleId, userId);
  if (input.amount <= 0n) throw new AppError('INVALID_AMOUNT', 'Enter an amount greater than zero', 400);

  let goal: CircleGoal | null = null;
  if (input.goalId) {
    goal = await prisma.circleGoal.findUnique({ where: { id: input.goalId } });
    if (!goal || goal.circleId !== circleId) throw new AppError('GOAL_NOT_FOUND', 'Goal not found in this Circle', 404);
    if (goal.status !== 'ACTIVE') throw new AppError('GOAL_CLOSED', 'This goal is no longer active', 409);
  }

  // Verification: a contribution is provider-confirmed ONLY when it points at a real,
  // completed transaction initiated by this member in the circle's currency.
  let verification: 'UNVERIFIED' | 'PROVIDER_CONFIRMED' = 'UNVERIFIED';
  let source: 'SELF_REPORT' | 'PAYMENT_TRANSACTION' = 'SELF_REPORT';
  if (input.transactionId) {
    const txn = await prisma.transaction.findUnique({ where: { id: input.transactionId } });
    if (
      txn &&
      txn.initiatorUserId === userId &&
      txn.status === 'SUCCESS' &&
      txn.currencyCode === circle.currencyCode &&
      txn.amount === input.amount
    ) {
      verification = 'PROVIDER_CONFIRMED';
      source = 'PAYMENT_TRANSACTION';
    } else {
      throw new AppError(
        'CONTRIBUTION_NOT_VERIFIABLE',
        'That payment could not be verified against your completed transactions',
        422,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const record = await tx.contributionRecord.create({
      data: {
        circleId,
        goalId: goal?.id,
        memberId: member.id,
        amount: input.amount,
        currencyCode: circle.currencyCode,
        source,
        verification,
        transactionId: source === 'PAYMENT_TRANSACTION' ? input.transactionId : null,
        externalRef: input.externalRef,
        note: input.note,
      },
    });
    await recordEvent(tx, circleId, 'CONTRIBUTION_RECORDED', { type: 'USER', id: userId }, {
      contributionId: record.id,
      verification,
    });

    // Auto-achieve a goal whose confirmed total reaches the target.
    if (goal) {
      const confirmed = await tx.contributionRecord.aggregate({
        where: { goalId: goal.id, verification: 'PROVIDER_CONFIRMED' },
        _sum: { amount: true },
      });
      if ((confirmed._sum.amount ?? 0n) >= goal.targetAmount) {
        await tx.circleGoal.update({ where: { id: goal.id }, data: { status: 'ACHIEVED' } });
        await recordEvent(tx, circleId, 'GOAL_ACHIEVED', { type: 'SYSTEM' }, { goalId: goal.id });
      }
    }
    return record;
  }, TX_OPTIONS);
}

// ─────────────────────── progress & report ───────────────────────

export interface CircleProgress {
  circleId: string;
  currencyCode: string;
  targetAmount: bigint | null;
  confirmedTotal: bigint;
  unverifiedTotal: bigint;
  goals: {
    goalId: string;
    title: string;
    targetAmount: bigint;
    confirmed: bigint;
    unverified: bigint;
    status: string;
    dueDate: Date | null;
  }[];
  members: {
    memberId: string;
    userId: string;
    role: string;
    confirmed: bigint;
    unverified: bigint;
    lastContributionAt: Date | null;
  }[];
}

/**
 * CircleGoalMonitor calculation: confirmed vs unverified amounts are always reported
 * separately — a self-reported number is never presented as real money.
 */
export async function getProgress(userId: string, circleId: string): Promise<CircleProgress> {
  await requireMember(circleId, userId);
  const circle = await prisma.circle.findUniqueOrThrow({ where: { id: circleId } });

  const contributions = await prisma.contributionRecord.findMany({
    where: { circleId },
    select: { memberId: true, goalId: true, amount: true, verification: true, recordedAt: true },
  });
  const members = await prisma.circleMember.findMany({ where: { circleId, status: 'ACTIVE' } });
  const goals = await prisma.circleGoal.findMany({ where: { circleId } });

  const sum = (rows: typeof contributions, verification: string) =>
    rows.filter((r) => r.verification === verification).reduce((acc, r) => acc + r.amount, 0n);

  return {
    circleId,
    currencyCode: circle.currencyCode,
    targetAmount: circle.targetAmount,
    confirmedTotal: sum(contributions, 'PROVIDER_CONFIRMED'),
    unverifiedTotal: sum(contributions, 'UNVERIFIED'),
    goals: goals.map((g) => {
      const rows = contributions.filter((c) => c.goalId === g.id);
      return {
        goalId: g.id,
        title: g.title,
        targetAmount: g.targetAmount,
        confirmed: sum(rows, 'PROVIDER_CONFIRMED'),
        unverified: sum(rows, 'UNVERIFIED'),
        status: g.status,
        dueDate: g.dueDate,
      };
    }),
    members: members.map((m) => {
      const rows = contributions.filter((c) => c.memberId === m.id);
      const last = rows.reduce<Date | null>((acc, r) => (!acc || r.recordedAt > acc ? r.recordedAt : acc), null);
      return {
        memberId: m.id,
        userId: m.userId,
        role: m.role,
        confirmed: sum(rows, 'PROVIDER_CONFIRMED'),
        unverified: sum(rows, 'UNVERIFIED'),
        lastContributionAt: last,
      };
    }),
  };
}

/** Full exportable report: circle, members, goals with progress, contributions, activity. */
export async function getReport(userId: string, circleId: string) {
  await requireMember(circleId, userId);
  const [circle, progress, contributions, events] = await Promise.all([
    prisma.circle.findUniqueOrThrow({
      where: { id: circleId },
      include: {
        members: { include: { user: { include: { profile: true } } } },
        goals: true,
      },
    }),
    getProgress(userId, circleId),
    prisma.contributionRecord.findMany({
      where: { circleId },
      include: { member: { include: { user: { include: { profile: true } } } } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.circleEvent.findMany({ where: { circleId }, orderBy: { id: 'desc' }, take: 200 }),
  ]);
  return { circle, progress, contributions, events };
}

/** Lists the caller's recorded contributions in a circle. */
export async function listContributions(userId: string, circleId: string) {
  await requireMember(circleId, userId);
  return prisma.contributionRecord.findMany({
    where: { circleId },
    include: { member: { include: { user: { include: { profile: true } } } }, goal: true },
    orderBy: { recordedAt: 'desc' },
    take: 100,
  });
}
