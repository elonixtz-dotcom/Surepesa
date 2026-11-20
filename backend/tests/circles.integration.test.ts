import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { deposit } from '../src/services/payment.service';
import {
  acceptInvitation,
  createCircle,
  createGoal,
  declineInvitation,
  getProgress,
  inviteToCircle,
  leaveCircle,
  listMyInvitations,
  recordContribution,
  removeMember,
  setMemberRole,
} from '../src/modules/circles/circles.service';

/**
 * Circles ★ tests against a real PostgreSQL database (blueprint §8/§17).
 * Point DATABASE_URL at a Neon *branch* used only for tests, then run:
 *   npx prisma migrate deploy && npx prisma db seed && npx vitest run tests/circles.integration.test.ts
 *
 * The financial boundary under test: Circles NEVER touch the ledger. A contribution is
 * PROVIDER_CONFIRMED only when backed by the member's own SUCCESS transaction.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;
const phone = () => `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function createUser() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: phone(),
      passwordHash: 'test',
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      paymentMethods: {
        create: {
          type: 'MOBILE_MONEY',
          provider: 'SIMULATED',
          accountNumber: `07${randomUUID().slice(0, 8)}`,
          maskedNumber: '07** *** ***',
          status: 'VERIFIED',
        },
      },
    },
    include: { paymentMethods: true },
  });
  return { user, methodId: user.paymentMethods[0]!.id };
}

describe.skipIf(!hasDb)('circles journey (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs the full circle journey: create, invite, join, goal, contributions, progress', async () => {
    const owner = await createUser();
    const memberA = await createUser();
    const memberB = await createUser();

    const circle = await createCircle({
      ownerId: owner.user.id,
      name: 'Family School Fees',
      type: 'FAMILY',
      targetAmount: TZS(300_000),
    });
    expect(circle.status).toBe('ACTIVE');

    // Invitations
    const inviteA = await inviteToCircle(owner.user.id, circle.id, memberA.user.phoneNumber!);
    const inviteB = await inviteToCircle(owner.user.id, circle.id, memberB.user.phoneNumber!);
    expect(inviteA.token).not.toBe(inviteB.token);

    const pending = await listMyInvitations(memberA.user.id);
    expect(pending.map((i) => i.token)).toContain(inviteA.token);

    await acceptInvitation(memberA.user.id, inviteA.token);
    await declineInvitation(memberB.user.id, inviteB.token);

    // A declined invitee is not a member and cannot contribute.
    await expect(
      recordContribution(memberB.user.id, circle.id, { amount: TZS(1_000) }),
    ).rejects.toMatchObject({ code: 'CIRCLE_NOT_FOUND' });

    // Goals
    const goal = await createGoal(owner.user.id, circle.id, {
      title: 'Term 1 fees',
      targetAmount: TZS(200_000),
      frequency: 'MONTHLY',
    });

    // Self-reported contribution stays UNVERIFIED.
    const selfReport = await recordContribution(memberA.user.id, circle.id, {
      goalId: goal.id,
      amount: TZS(50_000),
      note: 'Paid at the school office',
      externalRef: 'RCPT-123',
    });
    expect(selfReport.verification).toBe('UNVERIFIED');

    // A real deposit by the member backs a PROVIDER_CONFIRMED contribution.
    const txn = await deposit({
      userId: memberA.user.id,
      paymentMethodId: memberA.methodId,
      amount: TZS(100_000),
      idempotencyKey: randomUUID(),
    });
    expect(txn.status).toBe('SUCCESS');
    const confirmed = await recordContribution(memberA.user.id, circle.id, {
      goalId: goal.id,
      amount: TZS(100_000),
      transactionId: txn.id,
    });
    expect(confirmed.verification).toBe('PROVIDER_CONFIRMED');

    // Someone else's transaction cannot verify my contribution.
    const otherTxn = await deposit({
      userId: owner.user.id,
      paymentMethodId: owner.methodId,
      amount: TZS(100_000),
      idempotencyKey: randomUUID(),
    });
    await expect(
      recordContribution(memberA.user.id, circle.id, { amount: TZS(100_000), transactionId: otherTxn.id }),
    ).rejects.toMatchObject({ code: 'CONTRIBUTION_NOT_VERIFIABLE' });

    // Progress keeps confirmed and unverified separate.
    const progress = await getProgress(owner.user.id, circle.id);
    expect(progress.confirmedTotal).toBe(TZS(100_000));
    expect(progress.unverifiedTotal).toBe(TZS(50_000));
    const goalProgress = progress.goals.find((g) => g.goalId === goal.id)!;
    expect(goalProgress.confirmed).toBe(TZS(100_000));
    expect(goalProgress.status).toBe('ACTIVE'); // 100k of 200k: not achieved yet

    // Reaching the target auto-achieves the goal.
    const txn2 = await deposit({
      userId: memberA.user.id,
      paymentMethodId: memberA.methodId,
      amount: TZS(100_000),
      idempotencyKey: randomUUID(),
    });
    await recordContribution(memberA.user.id, circle.id, { goalId: goal.id, amount: TZS(100_000), transactionId: txn2.id });
    const after = await getProgress(owner.user.id, circle.id);
    expect(after.goals.find((g) => g.goalId === goal.id)!.status).toBe('ACHIEVED');

    // Roles: owner promotes the member; the new admin cannot change roles.
    await setMemberRole(owner.user.id, circle.id, memberA.user.id, 'ADMIN');
    await expect(
      setMemberRole(memberA.user.id, circle.id, owner.user.id, 'MEMBER'),
    ).rejects.toMatchObject({ code: 'CIRCLE_FORBIDDEN' });

    // Members can leave; the owner cannot.
    await expect(leaveCircle(owner.user.id, circle.id)).rejects.toMatchObject({ code: 'OWNER_CANNOT_LEAVE' });
    await removeMember(owner.user.id, circle.id, memberA.user.id);
    await expect(getProgress(memberA.user.id, circle.id)).rejects.toMatchObject({ code: 'CIRCLE_NOT_FOUND' });

    // The circle never touched the ledger: no wallet belongs to a circle.
    const ledgerEntries = await prisma.ledgerEntry.count({
      where: { transaction: { description: { contains: circle.reference } } },
    });
    expect(ledgerEntries).toBe(0);
  }, 180_000);

  it('rejects duplicate membership and enforces organiser permissions', async () => {
    const owner = await createUser();
    const member = await createUser();
    const circle = await createCircle({ ownerId: owner.user.id, name: 'Vikoba Group', type: 'VIKOBA' });

    const invite = await inviteToCircle(owner.user.id, circle.id, member.user.phoneNumber!);
    await acceptInvitation(member.user.id, invite.token);

    // Re-inviting an active member fails.
    await expect(inviteToCircle(owner.user.id, circle.id, member.user.phoneNumber!)).rejects.toMatchObject({
      code: 'ALREADY_MEMBER',
    });

    // A plain member cannot invite, create goals or change roles.
    await expect(inviteToCircle(member.user.id, circle.id, owner.user.phoneNumber!)).rejects.toMatchObject({
      code: 'CIRCLE_FORBIDDEN',
    });
    await expect(
      createGoal(member.user.id, circle.id, { title: 'X', targetAmount: TZS(10_000) }),
    ).rejects.toMatchObject({ code: 'CIRCLE_FORBIDDEN' });

    // An expired invitation cannot be accepted.
    await prisma.circleInvitation.update({
      where: { id: invite.id },
      data: { status: 'PENDING', expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(acceptInvitation(member.user.id, invite.token)).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
  });
});
