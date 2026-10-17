import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { audit } from '../audit';
import { requirePermission } from '../auth';
import { can } from '../permissions';
import { displayName, mask, money, pageParams, presentTransaction, transactionListInclude } from '../present';

export const customersRouter = Router();

/** Search by phone, email, name, or an SPX transaction reference. */
customersRouter.get('/customers', requirePermission('customers:view'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const q = String(req.query.q ?? '').trim();
  const status = req.query.status ? String(req.query.status) : undefined;

  const or: Prisma.UserWhereInput[] = [];
  if (q) {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4) or.push({ phoneNumber: { contains: digits.replace(/^0/, '') } });
    or.push({ email: { contains: q, mode: 'insensitive' } });
    or.push({ profile: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }] } });
    if (/^SPX-/i.test(q)) {
      const txn = await prisma.transaction.findUnique({ relationLoadStrategy: 'join',
        where: { reference: q.toUpperCase() },
        include: { sourceWallet: true, destinationWallet: true },
      });
      const ids = [txn?.sourceWallet?.userId, txn?.destinationWallet?.userId].filter((v): v is string => !!v);
      if (ids.length) or.push({ id: { in: ids } });
    }
  }
  const where: Prisma.UserWhereInput = {
    ...(or.length ? { OR: or } : {}),
    ...(status ? { status: status as Prisma.EnumUserStatusFilter['equals'] } : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ relationLoadStrategy: 'join',
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { profile: true, wallets: { where: { currencyCode: 'TZS' } } },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    items: await Promise.all(
      users.map(async (u) => ({
        id: u.id,
        name: displayName(u),
        phoneNumber: u.phoneNumber,
        email: u.email,
        status: u.status,
        kycStatus: u.kycStatus,
        accountType: u.accountType,
        balance: u.wallets[0] ? await money(u.wallets[0].balance, 'TZS') : null,
        createdAt: u.createdAt,
      })),
    ),
  });
});

/** Customer 360: profile, wallets, recent activity, KYC and support history. Every view is audited. */
customersRouter.get('/customers/:id', requirePermission('customers:view'), async (req, res) => {
  const id = String(req.params.id);
  const user = await prisma.user.findUnique({ relationLoadStrategy: 'join',
    where: { id },
    include: {
      profile: true,
      wallets: true,
      businesses: { select: { id: true, tradingName: true, merchantCode: true, isActive: true } },
      kycSubmissions: { orderBy: { submittedAt: 'desc' }, include: { reviewedBy: { select: { fullName: true } } } },
      supportCases: { orderBy: { createdAt: 'desc' }, take: 20, include: { assignedTo: { select: { fullName: true } } } },
    },
  });
  if (!user) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);

  const walletIds = user.wallets.map((w) => w.id);
  const transactions = await prisma.transaction.findMany({ relationLoadStrategy: 'join',
    where: { OR: [{ sourceWalletId: { in: walletIds } }, { destinationWalletId: { in: walletIds } }] },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: transactionListInclude,
  });

  const seesFullIds = can(req.admin!.role, 'kyc:review');
  await audit({ actorId: req.admin!.id, action: 'CUSTOMER_VIEWED', entityType: 'User', entityId: user.id, ipAddress: req.ip });

  res.json({
    id: user.id,
    name: displayName(user),
    phoneNumber: user.phoneNumber,
    email: user.email,
    status: user.status,
    kycStatus: user.kycStatus,
    accountType: user.accountType,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    profile: user.profile,
    businesses: user.businesses,
    wallets: await Promise.all(
      user.wallets.map(async (w) => ({ id: w.id, currency: w.currencyCode, balance: await money(w.balance, w.currencyCode), status: w.status })),
    ),
    transactions: await Promise.all(
      transactions.map(async (t) => ({
        ...(await presentTransaction(t)),
        direction: walletIds.includes(t.sourceWalletId ?? '') ? 'OUT' : 'IN',
      })),
    ),
    kyc: user.kycSubmissions.map((k) => ({
      id: k.id,
      status: k.status,
      idType: k.idType,
      idNumber: seesFullIds ? k.idNumber : mask(k.idNumber),
      submittedAt: k.submittedAt,
      reviewedAt: k.reviewedAt,
      reviewedBy: k.reviewedBy?.fullName ?? null,
      rejectionReason: k.rejectionReason,
    })),
    cases: user.supportCases.map((c) => ({
      id: c.id,
      reference: c.reference,
      subject: c.subject,
      status: c.status,
      priority: c.priority,
      category: c.category,
      assignedTo: c.assignedTo?.fullName ?? null,
      createdAt: c.createdAt,
    })),
  });
});

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().min(5).max(500),
});

/** Suspend or reactivate an account (Compliance / System Controller). */
customersRouter.post('/customers/:id/status', requirePermission('customers:status'), async (req, res) => {
  const { status, reason } = statusSchema.parse(req.body);
  const id = String(req.params.id);
  const user = await prisma.user.findUnique({ relationLoadStrategy: 'join', where: { id } });
  if (!user) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
  if (user.status === status) throw new AppError('NO_CHANGE', `Account is already ${status.toLowerCase()}`, 409);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: { status } });
    await audit(
      {
        actorId: req.admin!.id,
        action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
        entityType: 'User',
        entityId: id,
        before: { status: user.status },
        after: { status, reason },
        ipAddress: req.ip,
      },
      tx,
    );
    return u;
  });
  res.json({ id: updated.id, status: updated.status });
});
