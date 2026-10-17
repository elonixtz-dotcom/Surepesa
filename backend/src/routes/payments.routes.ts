import { Request, Router } from 'express';
import { Prisma, Transaction } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { toMinorUnits } from '../lib/money';
import { requireAuth } from '../middleware/auth';
import { getProvider } from '../providers';
import { quoteFee } from '../services/fee.service';
import { deposit, payMerchant, sendMoney, withdraw } from '../services/payment.service';
import { verifyPin } from '../services/pin.service';
import { displayMoney, loadReceipt, maskPhone, minorUnitsOf, presentReceipt, railName, receiptInclude, registeredName } from '../services/receipt.service';
import { getOrCreateUserWallet } from '../services/wallet.service';

/**
 * Customer payments: /v1/payments, /v1/transactions, /v1/payment-methods
 *
 * Every payment that moves money out follows the same confirm pattern:
 *   1. POST /v1/payments/quote  -> recipient's registered name, fee and total (no money moves)
 *   2. the app shows them; the customer enters their PIN
 *   3. POST /v1/payments/<flow> with the PIN and an Idempotency-Key header
 * The response is always a receipt. A retried request with the same key returns the same
 * receipt instead of paying twice.
 */
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const phone = z.string().regex(/^\+255[67]\d{8}$/, 'Use the format +2557XXXXXXXX');
const decimalAmount = z.string().trim().min(1).max(20);
const pin = z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit PIN');

function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–100 characters) with every payment', 400);
  }
  return key;
}

async function toMinor(amount: string, currency: string): Promise<bigint> {
  try {
    const minor = toMinorUnits(amount, await minorUnitsOf(currency));
    if (minor <= 0n) throw new RangeError('not positive');
    return minor;
  } catch {
    throw new AppError('INVALID_AMOUNT', 'Enter a valid amount greater than zero', 400);
  }
}

async function findRecipient(phoneNumber: string) {
  const user = await prisma.user.findUnique({ where: { phoneNumber }, include: { profile: true } });
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError('RECIPIENT_NOT_FOUND', 'No active SurePesa account uses this number', 404);
  }
  return user;
}

async function findMerchant(merchantCode: string) {
  const business = await prisma.business.findUnique({ where: { merchantCode: merchantCode.toUpperCase() } });
  if (!business || !business.isActive) throw new AppError('MERCHANT_NOT_FOUND', 'No merchant uses this code', 404);
  return business;
}

async function ownMethod(userId: string, id: string) {
  const method = await prisma.paymentMethod.findUnique({ where: { id } });
  if (!method || method.userId !== userId || method.status === 'DISABLED') {
    throw new AppError('PAYMENT_METHOD_NOT_FOUND', 'Payment method not found', 404);
  }
  return method;
}

async function receipt(txn: Transaction, userId: string) {
  return loadReceipt(txn.id, userId);
}

// ───────────────────────── Quote ─────────────────────────

const quoteSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('P2P_TRANSFER'), recipientPhone: phone, amount: decimalAmount }),
  z.object({ type: z.literal('MERCHANT_PAYMENT'), merchantCode: z.string().trim().min(3).max(20), amount: decimalAmount }),
  z.object({ type: z.literal('WITHDRAWAL'), paymentMethodId: z.string().uuid(), amount: decimalAmount }),
  z.object({ type: z.literal('DEPOSIT'), paymentMethodId: z.string().uuid(), amount: decimalAmount }),
]);

/** What the confirmation screen shows. Moves no money and needs no PIN. */
paymentsRouter.post('/payments/quote', async (req, res) => {
  const input = quoteSchema.parse(req.body);
  const userId = req.user!.id;
  const currency = 'TZS';
  const amount = await toMinor(input.amount, currency);

  let recipient: { name: string | null; account: string | null };
  switch (input.type) {
    case 'P2P_TRANSFER': {
      const r = await findRecipient(input.recipientPhone);
      if (r.id === userId) throw new AppError('SELF_TRANSFER', 'You cannot send money to yourself');
      recipient = { name: registeredName(r.profile), account: maskPhone(r.phoneNumber) };
      break;
    }
    case 'MERCHANT_PAYMENT': {
      const b = await findMerchant(input.merchantCode);
      recipient = { name: b.tradingName, account: b.merchantCode };
      break;
    }
    default: {
      const method = await ownMethod(userId, input.paymentMethodId);
      // Ask the rail who the account belongs to, so the customer can spot a wrong number.
      const lookup = await getProvider(method.provider).lookupAccount(method.accountNumber).catch(() => null);
      if (lookup && !lookup.valid) throw new AppError('ACCOUNT_INVALID', `${railName(method.provider)} does not recognise this account`, 422);
      recipient = { name: lookup?.accountName ?? method.accountName, account: method.maskedNumber };
    }
  }

  const fee = await quoteFee(input.type, amount);
  const outgoing = input.type !== 'DEPOSIT';
  const wallet = await getOrCreateUserWallet(prisma, userId, currency);
  res.json({
    type: input.type,
    recipient,
    amount: await displayMoney(amount, currency),
    fee: await displayMoney(fee, currency),
    total: await displayMoney(amount + (outgoing ? fee : 0n), currency),
    currency,
    requiresPin: outgoing,
    sufficientBalance: outgoing ? wallet.balance >= amount + fee : true,
    notice:
      input.type === 'DEPOSIT'
        ? 'You will get a prompt on your phone. Enter your mobile money PIN there to approve.'
        : null,
  });
});

// ───────────────────────── Payments ─────────────────────────

paymentsRouter.post('/payments/send', async (req, res) => {
  const input = z
    .object({ recipientPhone: phone, amount: decimalAmount, pin, description: z.string().trim().max(140).optional() })
    .parse(req.body);
  const key = idempotencyKey(req);
  const recipient = await findRecipient(input.recipientPhone);
  await verifyPin(req.user!.id, input.pin);
  const txn = await sendMoney({
    senderUserId: req.user!.id,
    recipientUserId: recipient.id,
    amount: await toMinor(input.amount, 'TZS'),
    idempotencyKey: key,
    description: input.description,
  });
  res.status(201).json(await receipt(txn, req.user!.id));
});

paymentsRouter.post('/payments/merchant', async (req, res) => {
  const input = z
    .object({
      merchantCode: z.string().trim().min(3).max(20),
      amount: decimalAmount,
      pin,
      qrCodeId: z.string().uuid().optional(),
      // The token a scanned TANQR code carries in its reference label (tag 62/05).
      qrToken: z.string().trim().min(8).max(64).optional(),
    })
    .parse(req.body);
  const key = idempotencyKey(req);
  const business = await findMerchant(input.merchantCode);
  let qrCodeId = input.qrCodeId;
  if (!qrCodeId && input.qrToken) {
    const qr = await prisma.qrCode.findUnique({ where: { token: input.qrToken }, select: { id: true } });
    if (!qr) throw new AppError('QR_INVALID', 'This QR code is not valid for this merchant', 422);
    qrCodeId = qr.id;
  }
  await verifyPin(req.user!.id, input.pin);
  const txn = await payMerchant({
    payerUserId: req.user!.id,
    businessId: business.id,
    amount: await toMinor(input.amount, 'TZS'),
    idempotencyKey: key,
    qrCodeId,
  });
  res.status(201).json(await receipt(txn, req.user!.id));
});

paymentsRouter.post('/payments/withdraw', async (req, res) => {
  const input = z.object({ paymentMethodId: z.string().uuid(), amount: decimalAmount, pin }).parse(req.body);
  const key = idempotencyKey(req);
  await verifyPin(req.user!.id, input.pin);
  const txn = await withdraw({
    userId: req.user!.id,
    paymentMethodId: input.paymentMethodId,
    amount: await toMinor(input.amount, 'TZS'),
    idempotencyKey: key,
  });
  // 202 while the rail is still working on it: poll GET /v1/transactions/:reference.
  res.status(txn.status === 'PROCESSING' ? 202 : 201).json(await receipt(txn, req.user!.id));
});

/** Add money from mobile money. No SurePesa PIN: the customer approves on their phone. */
paymentsRouter.post('/payments/deposit', async (req, res) => {
  const input = z.object({ paymentMethodId: z.string().uuid(), amount: decimalAmount }).parse(req.body);
  const key = idempotencyKey(req);
  const txn = await deposit({
    userId: req.user!.id,
    paymentMethodId: input.paymentMethodId,
    amount: await toMinor(input.amount, 'TZS'),
    idempotencyKey: key,
  });
  res.status(txn.status === 'PROCESSING' ? 202 : 201).json(await receipt(txn, req.user!.id));
});

// ─────────────────────── History & receipts ───────────────────────

async function myWalletIds(userId: string): Promise<string[]> {
  const wallets = await prisma.wallet.findMany({
    where: { OR: [{ userId }, { business: { ownerId: userId } }, { card: { userId } }] },
    select: { id: true },
  });
  return wallets.map((w) => w.id);
}

paymentsRouter.get('/transactions', async (req, res) => {
  const { limit, before } = z
    .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.date().optional() })
    .parse(req.query);
  const walletIds = await myWalletIds(req.user!.id);
  const where: Prisma.TransactionWhereInput = {
    OR: [{ sourceWalletId: { in: walletIds } }, { destinationWalletId: { in: walletIds } }],
    ...(before ? { createdAt: { lt: before } } : {}),
  };
  const items = await prisma.transaction.findMany({
    relationLoadStrategy: 'join',
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: receiptInclude,
  });
  res.json({
    items: await Promise.all(items.map((t) => presentReceipt(t, req.user!.id))),
    // Pass as `before` to get the next page.
    next: items.length === limit ? items[items.length - 1]!.createdAt : null,
  });
});

paymentsRouter.get('/transactions/:reference', async (req, res) => {
  const txn = await prisma.transaction.findUnique({
    relationLoadStrategy: 'join',
    where: { reference: String(req.params.reference).toUpperCase() },
    include: receiptInclude,
  });
  const walletIds = new Set(await myWalletIds(req.user!.id));
  if (!txn || !(walletIds.has(txn.sourceWalletId ?? '') || walletIds.has(txn.destinationWalletId ?? ''))) {
    throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
  }
  res.json(await presentReceipt(txn, req.user!.id));
});

// ───────────────────────── Payment methods ─────────────────────────

const MOBILE_MONEY_PROVIDERS = ['MPESA_TZ', 'AIRTEL_TZ', 'YAS_TZ', 'HALOPESA'] as const;

paymentsRouter.get('/payment-methods', async (req, res) => {
  const methods = await prisma.paymentMethod.findMany({
    where: { userId: req.user!.id, status: { not: 'DISABLED' } },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  res.json({
    items: methods.map((m) => ({
      id: m.id,
      type: m.type,
      provider: m.provider,
      providerName: railName(m.provider),
      label: m.label,
      accountName: m.accountName,
      maskedNumber: m.maskedNumber,
      status: m.status,
      isDefault: m.isDefault,
    })),
  });
});

/**
 * Link a mobile money account. The rail's registered name comes back so the app can ask
 * "Is this you?" before the account is used.
 */
paymentsRouter.post('/payment-methods', async (req, res) => {
  const input = z
    .object({ provider: z.enum(MOBILE_MONEY_PROVIDERS), phoneNumber: phone, label: z.string().trim().max(40).optional() })
    .parse(req.body);
  const userId = req.user!.id;

  const lookup = await getProvider(input.provider).lookupAccount(input.phoneNumber);
  if (!lookup.valid) throw new AppError('ACCOUNT_INVALID', `${railName(input.provider)} does not recognise this number`, 422);

  const count = await prisma.paymentMethod.count({ where: { userId, status: { not: 'DISABLED' } } });
  if (count >= 5) throw new AppError('TOO_MANY_METHODS', 'You can link up to 5 accounts', 409);

  try {
    const m = await prisma.paymentMethod.create({
      data: {
        userId,
        type: 'MOBILE_MONEY',
        provider: input.provider,
        label: input.label ?? railName(input.provider),
        accountName: lookup.accountName,
        accountNumber: input.phoneNumber,
        maskedNumber: maskPhone(input.phoneNumber)!,
        isDefault: count === 0,
      },
    });
    res.status(201).json({ id: m.id, provider: m.provider, providerName: railName(m.provider), accountName: m.accountName, maskedNumber: m.maskedNumber, status: m.status, isDefault: m.isDefault });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('METHOD_EXISTS', 'This account is already linked', 409);
    }
    throw err;
  }
});
