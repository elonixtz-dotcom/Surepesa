import {
  ActorType,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionType,
  User,
} from '@prisma/client';
import { prisma, TX_OPTIONS } from '../lib/prisma';
import { AppError, PaymentRejectedError } from '../lib/errors';
import { newTransactionReference } from '../lib/reference';
import { LedgerLine, postLedgerLines } from './ledger.service';
import { calculateFee } from './fee.service';
import {
  getOrCreateBusinessWallet,
  getOrCreateUserWallet,
  getSystemWallet,
  systemWalletCode,
} from './wallet.service';
import { getProvider } from '../providers';

/**
 * Payment engine.
 *
 * Every flow follows the same shape:
 *   1. Authorise on the server (never trust the client's view of balances or ownership).
 *   2. Record the intent as a Transaction (idempotent per initiator + key).
 *   3. Move money with a single ledger posting inside one DB transaction.
 *   4. Record the outcome: SUCCESS, or FAILED with a reason — money never half-moves.
 */

interface Actor {
  type: ActorType;
  id?: string;
}

const SYSTEM: Actor = { type: 'SYSTEM' };

// ───────────────────────── Policy ─────────────────────────

/** Rules a user must meet before money can leave their wallet. */
function assertCanSend(user: User): void {
  if (user.status !== 'ACTIVE') {
    throw new PaymentRejectedError('ACCOUNT_NOT_ACTIVE', 'Your account is not active');
  }
  if (user.kycStatus !== 'APPROVED') {
    throw new PaymentRejectedError('KYC_REQUIRED', 'Verify your identity before sending money');
  }
}

function assertCanReceive(user: User): void {
  if (user.status !== 'ACTIVE') {
    throw new PaymentRejectedError('RECIPIENT_NOT_ACTIVE', 'The recipient cannot receive payments');
  }
}

function assertPositive(amount: bigint): void {
  if (amount <= 0n) throw new AppError('INVALID_AMOUNT', 'Amount must be greater than zero');
}

async function loadUser(userId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('USER_NOT_FOUND', 'User not found', 404);
  return user;
}

// ─────────────────────── Core engine ───────────────────────

interface TransactionIntent {
  type: TransactionType;
  initiatorUserId?: string;
  initiatorAdminId?: string;
  idempotencyKey?: string;
  sourceWalletId: string;
  destinationWalletId: string;
  amount: bigint;
  currencyCode: string;
  fee?: bigint;
  description?: string;
  paymentMethodId?: string;
  qrCodeId?: string;
  providerName?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Creates the Transaction row in PROCESSING. If the same initiator already used this
 * idempotency key, returns the original transaction instead (`replayed: true`).
 */
async function openTransaction(
  intent: TransactionIntent,
  actor: Actor,
): Promise<{ txn: Transaction; replayed: boolean }> {
  const findExisting = () =>
    intent.idempotencyKey && intent.initiatorUserId
      ? prisma.transaction.findUnique({
          where: {
            initiatorUserId_idempotencyKey: {
              initiatorUserId: intent.initiatorUserId,
              idempotencyKey: intent.idempotencyKey,
            },
          },
        })
      : Promise.resolve(null);

  const checkReplay = (existing: Transaction) => {
    const same =
      existing.type === intent.type &&
      existing.amount === intent.amount &&
      existing.destinationWalletId === intent.destinationWalletId;
    if (!same) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used for a different payment',
        409,
      );
    }
    return { txn: existing, replayed: true };
  };

  const existing = await findExisting();
  if (existing) return checkReplay(existing);

  try {
    const txn = await prisma.transaction.create({
      data: {
        reference: newTransactionReference(),
        type: intent.type,
        status: 'PROCESSING',
        initiatorUserId: intent.initiatorUserId,
        initiatorAdminId: intent.initiatorAdminId,
        idempotencyKey: intent.idempotencyKey,
        sourceWalletId: intent.sourceWalletId,
        destinationWalletId: intent.destinationWalletId,
        amount: intent.amount,
        currencyCode: intent.currencyCode,
        fee: intent.fee ?? 0n,
        description: intent.description,
        paymentMethodId: intent.paymentMethodId,
        qrCodeId: intent.qrCodeId,
        providerName: intent.providerName,
        metadata: intent.metadata,
        events: {
          create: { fromStatus: null, toStatus: 'PROCESSING', actorType: actor.type, actorId: actor.id },
        },
      },
    });
    return { txn, replayed: false };
  } catch (err) {
    // Two identical requests raced past findExisting(); the unique index picked a winner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await findExisting();
      if (winner) return checkReplay(winner);
    }
    throw err;
  }
}

/** Standard lines: principal source -> destination, fee source -> fee wallet. */
function transferLines(
  sourceWalletId: string,
  destinationWalletId: string,
  amount: bigint,
  fee: bigint,
  feeWalletId: string,
): LedgerLine[] {
  const lines: LedgerLine[] = [
    { walletId: sourceWalletId, amount: -amount, entryType: 'PRINCIPAL' },
    { walletId: destinationWalletId, amount, entryType: 'PRINCIPAL' },
  ];
  if (fee > 0n) {
    lines.push(
      { walletId: sourceWalletId, amount: -fee, entryType: 'FEE' },
      { walletId: feeWalletId, amount: fee, entryType: 'FEE' },
    );
  }
  return lines;
}

async function transition(
  tx: Prisma.TransactionClient,
  txn: Transaction,
  to: TransactionStatus,
  actor: Actor,
  extra: Prisma.TransactionUpdateInput = {},
  note?: string,
): Promise<Transaction> {
  return tx.transaction.update({
    where: { id: txn.id },
    data: {
      ...extra,
      status: to,
      completedAt: to === 'SUCCESS' || to === 'FAILED' || to === 'REVERSED' ? new Date() : undefined,
      events: {
        create: { fromStatus: txn.status, toStatus: to, actorType: actor.type, actorId: actor.id, note },
      },
    },
  });
}

/** Marks a transaction FAILED without moving money. */
async function failTransaction(txn: Transaction, code: string, reason: string, actor: Actor = SYSTEM) {
  return transition(prisma, txn, 'FAILED', actor, { failureCode: code, failureReason: reason }, reason);
}

/**
 * Posts the ledger lines and moves the transaction to `finalStatus` atomically.
 * Business rejections (insufficient funds, frozen wallet ...) mark it FAILED.
 */
async function settle(
  txn: Transaction,
  buildLines: (tx: Prisma.TransactionClient) => Promise<LedgerLine[]>,
  actor: Actor,
  finalStatus: TransactionStatus = 'SUCCESS',
  extra: Prisma.TransactionUpdateInput = {},
): Promise<Transaction> {
  try {
    return await prisma.$transaction(async (tx) => {
      await postLedgerLines(tx, txn.id, await buildLines(tx));
      return finalStatus === txn.status
        ? tx.transaction.update({ where: { id: txn.id }, data: extra })
        : transition(tx, txn, finalStatus, actor, extra);
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof PaymentRejectedError) {
      return failTransaction(txn, err.code, err.message, actor);
    }
    // Unexpected error: the DB transaction rolled back, so no money moved.
    await failTransaction(txn, 'INTERNAL_ERROR', 'Payment could not be completed').catch(() => undefined);
    throw err;
  }
}

/** Runs a flow for a txn that was just opened; replays return the stored result untouched. */
async function run(
  opened: { txn: Transaction; replayed: boolean },
  execute: (txn: Transaction) => Promise<Transaction>,
): Promise<Transaction> {
  return opened.replayed ? opened.txn : execute(opened.txn);
}

// ───────────────────────── Flows ─────────────────────────

export interface SendMoneyInput {
  senderUserId: string;
  recipientUserId: string;
  amount: bigint;
  currency?: string;
  idempotencyKey: string;
  description?: string;
}

/** Person-to-person transfer between SurePesa wallets. */
export async function sendMoney(input: SendMoneyInput): Promise<Transaction> {
  const currency = input.currency ?? 'TZS';
  assertPositive(input.amount);
  if (input.senderUserId === input.recipientUserId) {
    throw new AppError('SELF_TRANSFER', 'You cannot send money to yourself');
  }
  const [sender, recipient] = await Promise.all([loadUser(input.senderUserId), loadUser(input.recipientUserId)]);
  assertCanSend(sender);
  assertCanReceive(recipient);

  const [source, destination] = await Promise.all([
    getOrCreateUserWallet(prisma, sender.id, currency),
    getOrCreateUserWallet(prisma, recipient.id, currency),
  ]);
  const fee = calculateFee('P2P_TRANSFER', input.amount);
  const actor: Actor = { type: 'USER', id: sender.id };

  const opened = await openTransaction(
    {
      type: 'P2P_TRANSFER',
      initiatorUserId: sender.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amount: input.amount,
      currencyCode: currency,
      fee,
      description: input.description,
    },
    actor,
  );

  return run(opened, (txn) =>
    settle(
      txn,
      async (tx) =>
        transferLines(source.id, destination.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(currency))).id),
      actor,
    ),
  );
}

export interface PayMerchantInput {
  payerUserId: string;
  businessId: string;
  amount: bigint;
  currency?: string;
  idempotencyKey: string;
  qrCodeId?: string;
  description?: string;
}

/** Consumer -> merchant payment (e.g. after scanning a SurePesa QR code). */
export async function payMerchant(input: PayMerchantInput): Promise<Transaction> {
  const currency = input.currency ?? 'TZS';
  assertPositive(input.amount);
  const payer = await loadUser(input.payerUserId);
  assertCanSend(payer);

  const business = await prisma.business.findUnique({ where: { id: input.businessId } });
  if (!business || !business.isActive) {
    throw new PaymentRejectedError('MERCHANT_UNAVAILABLE', 'This merchant cannot accept payments');
  }
  if (business.ownerId === payer.id) {
    throw new AppError('SELF_TRANSFER', 'You cannot pay your own business');
  }

  const [source, destination] = await Promise.all([
    getOrCreateUserWallet(prisma, payer.id, currency),
    getOrCreateBusinessWallet(prisma, business.id, currency),
  ]);
  const fee = calculateFee('MERCHANT_PAYMENT', input.amount);
  const actor: Actor = { type: 'USER', id: payer.id };

  const opened = await openTransaction(
    {
      type: 'MERCHANT_PAYMENT',
      initiatorUserId: payer.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amount: input.amount,
      currencyCode: currency,
      fee,
      qrCodeId: input.qrCodeId,
      description: input.description ?? business.tradingName,
    },
    actor,
  );

  return run(opened, (txn) =>
    settle(
      txn,
      async (tx) =>
        transferLines(source.id, destination.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(currency))).id),
      actor,
    ),
  );
}

export interface ExternalTransferInput {
  userId: string;
  paymentMethodId: string;
  amount: bigint;
  idempotencyKey: string;
}

async function loadPaymentMethod(userId: string, paymentMethodId: string) {
  const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
  if (!method || method.userId !== userId) {
    throw new AppError('PAYMENT_METHOD_NOT_FOUND', 'Payment method not found', 404);
  }
  if (method.status === 'DISABLED') {
    throw new PaymentRejectedError('PAYMENT_METHOD_DISABLED', 'This payment method is disabled');
  }
  return method;
}

/** "Add money": pull from the user's mobile-money / bank account into their wallet. */
export async function deposit(input: ExternalTransferInput): Promise<Transaction> {
  assertPositive(input.amount);
  const user = await loadUser(input.userId);
  if (user.status !== 'ACTIVE') throw new PaymentRejectedError('ACCOUNT_NOT_ACTIVE', 'Your account is not active');
  const method = await loadPaymentMethod(user.id, input.paymentMethodId);
  const provider = getProvider(method.provider);
  const currency = method.currencyCode;

  const [wallet, float] = await Promise.all([
    getOrCreateUserWallet(prisma, user.id, currency),
    getSystemWallet(prisma, systemWalletCode.float(currency, provider.name)),
  ]);
  const actor: Actor = { type: 'USER', id: user.id };

  const opened = await openTransaction(
    {
      type: 'DEPOSIT',
      initiatorUserId: user.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: float.id,
      destinationWalletId: wallet.id,
      amount: input.amount,
      currencyCode: currency,
      fee: calculateFee('DEPOSIT', input.amount),
      paymentMethodId: method.id,
      providerName: provider.name,
    },
    actor,
  );

  return run(opened, async (txn) => {
    const result = await provider.collect({
      reference: txn.reference,
      amount: txn.amount,
      currency,
      accountNumber: method.accountNumber,
    });
    if (result.status === 'FAILED') {
      return failTransaction(txn, result.failureCode ?? 'PROVIDER_DECLINED', result.failureReason ?? 'Declined by provider');
    }
    if (result.status === 'PENDING') {
      // Real rails confirm asynchronously; the provider webhook will call settle().
      return prisma.transaction.update({
        where: { id: txn.id },
        data: { providerReference: result.providerReference },
      });
    }
    return settle(
      txn,
      async (tx) => transferLines(float.id, wallet.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(currency))).id),
      SYSTEM,
      'SUCCESS',
      { providerReference: result.providerReference },
    );
  });
}

/**
 * Withdraw to the user's mobile-money / bank account.
 * Funds leave the wallet *before* the payout is requested, so they cannot be spent twice;
 * a failed payout is automatically reversed.
 */
export async function withdraw(input: ExternalTransferInput): Promise<Transaction> {
  assertPositive(input.amount);
  const user = await loadUser(input.userId);
  assertCanSend(user);
  const method = await loadPaymentMethod(user.id, input.paymentMethodId);
  const provider = getProvider(method.provider);
  const currency = method.currencyCode;

  const [wallet, float] = await Promise.all([
    getOrCreateUserWallet(prisma, user.id, currency),
    getSystemWallet(prisma, systemWalletCode.float(currency, provider.name)),
  ]);
  const actor: Actor = { type: 'USER', id: user.id };

  const opened = await openTransaction(
    {
      type: 'WITHDRAWAL',
      initiatorUserId: user.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: wallet.id,
      destinationWalletId: float.id,
      amount: input.amount,
      currencyCode: currency,
      fee: calculateFee('WITHDRAWAL', input.amount),
      paymentMethodId: method.id,
      providerName: provider.name,
    },
    actor,
  );

  return run(opened, async (txn) => {
    // Step 1: debit the wallet (status stays PROCESSING until the provider confirms).
    const debited = await settle(
      txn,
      async (tx) => transferLines(wallet.id, float.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(currency))).id),
      actor,
      'PROCESSING',
    );
    if (debited.status === 'FAILED') return debited;

    // Step 2: ask the rail to pay out.
    const result = await provider.payout({
      reference: txn.reference,
      amount: txn.amount,
      currency,
      accountNumber: method.accountNumber,
    });
    if (result.status === 'SUCCESS') {
      return transition(prisma, debited, 'SUCCESS', SYSTEM, { providerReference: result.providerReference });
    }
    if (result.status === 'PENDING') {
      return prisma.transaction.update({ where: { id: txn.id }, data: { providerReference: result.providerReference } });
    }
    // Step 3: payout failed — return the money; the withdrawal itself ends FAILED.
    await reverseTransaction(txn.id, {
      actor: SYSTEM,
      reason: result.failureReason ?? 'Payout failed',
      allowFromStatus: 'PROCESSING',
      markOriginalAs: 'FAILED',
      originalUpdate: {
        failureCode: result.failureCode ?? 'PAYOUT_FAILED',
        failureReason: result.failureReason,
        providerReference: result.providerReference,
      },
    });
    return prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
  });
}

export interface ReverseOptions {
  actor: Actor;
  reason: string;
  /** Internal use: withdrawals are reversed from PROCESSING when the payout fails. */
  allowFromStatus?: TransactionStatus;
  /** Status given to the original; REVERSED unless the original never completed. */
  markOriginalAs?: TransactionStatus;
  originalUpdate?: Prisma.TransactionUpdateInput;
}

/**
 * Creates a REVERSAL transaction that posts the exact opposite of the original's ledger
 * lines, then marks the original REVERSED. Fails (and changes nothing) if the receiver
 * no longer has the funds.
 */
export async function reverseTransaction(transactionId: string, opts: ReverseOptions): Promise<Transaction> {
  return prisma.$transaction(async (tx) => {
    // Lock the original so two admins cannot reverse it at the same time.
    await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
    const original = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { ledgerEntries: { orderBy: { id: 'asc' } }, reversedBy: true },
    });
    if (!original) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
    if (original.reversedBy) throw new AppError('ALREADY_REVERSED', 'Transaction has already been reversed', 409);
    const allowed: TransactionStatus[] = ['SUCCESS', ...(opts.allowFromStatus ? [opts.allowFromStatus] : [])];
    if (!allowed.includes(original.status) || original.type === 'REVERSAL') {
      throw new AppError('NOT_REVERSIBLE', `A ${original.status} ${original.type} cannot be reversed`, 409);
    }
    if (!original.ledgerEntries.length) {
      throw new AppError('NOT_REVERSIBLE', 'Transaction has no ledger postings', 409);
    }

    const reversal = await tx.transaction.create({
      data: {
        reference: newTransactionReference(),
        type: 'REVERSAL',
        status: 'PROCESSING',
        initiatorAdminId: opts.actor.type === 'ADMIN' ? opts.actor.id : undefined,
        sourceWalletId: original.destinationWalletId,
        destinationWalletId: original.sourceWalletId,
        amount: original.amount,
        currencyCode: original.currencyCode,
        fee: original.fee,
        reversesTransactionId: original.id,
        description: opts.reason,
        events: { create: { toStatus: 'PROCESSING', actorType: opts.actor.type, actorId: opts.actor.id, note: opts.reason } },
      },
    });

    await postLedgerLines(
      tx,
      reversal.id,
      original.ledgerEntries.map((e) => ({ walletId: e.walletId, amount: -e.amount, entryType: 'REVERSAL' })),
    );

    await transition(tx, original, opts.markOriginalAs ?? 'REVERSED', opts.actor, opts.originalUpdate, opts.reason);
    if (opts.actor.type === 'ADMIN') {
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: opts.actor.id,
          action: 'TRANSACTION_REVERSED',
          entityType: 'Transaction',
          entityId: original.id,
          before: { status: original.status },
          after: { status: 'REVERSED', reversalId: reversal.id, reason: opts.reason },
        },
      });
    }
    return transition(tx, reversal, 'SUCCESS', opts.actor);
  }, TX_OPTIONS);
}
