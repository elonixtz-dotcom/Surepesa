import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { fromMinorUnits } from '../lib/money';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserWallet } from '../services/wallet.service';
import { setPin, verifyPin } from '../services/pin.service';

export const meRouter = Router();
meRouter.use(requireAuth);

/** Public view of the current user. Never includes password/PIN hashes or auth internals. */
async function loadMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true, wallets: { include: { currency: true } } },
  });
  return {
    id: user.id,
    email: user.email,
    phoneNumber: user.phoneNumber,
    accountType: user.accountType,
    status: user.status,
    kycStatus: user.kycStatus,
    hasPin: Boolean(user.pinHash),
    profile: user.profile,
    wallets: user.wallets.map((w) => ({
      id: w.id,
      currency: w.currencyCode,
      balance: fromMinorUnits(w.balance, w.currency.minorUnits),
      status: w.status,
    })),
  };
}

/** Current user, profile and wallets (balances as decimal strings). */
meRouter.get('/', async (req, res) => {
  res.json(await loadMe(req.user!.id));
});

const onboardingSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  middleName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().min(1).max(60),
  // Tanzanian mobile numbers in E.164: +255 followed by 9 digits starting 6 or 7.
  phoneNumber: z.string().regex(/^\+255[67]\d{8}$/, 'Use the format +2557XXXXXXXX'),
});

/** Completes registration after sign-in: profile, phone number and the TZS wallet. */
meRouter.post('/onboarding', async (req, res) => {
  const input = onboardingSchema.parse(req.body);
  const owner = await prisma.user.findUnique({ where: { phoneNumber: input.phoneNumber } });
  if (owner && owner.id !== req.user!.id) {
    throw new AppError('PHONE_IN_USE', 'This phone number is already registered', 409);
  }

  const { phoneNumber, ...profile } = input;
  await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      phoneNumber,
      // TODO(milestone 2): require OTP verification of the phone before activating.
      status: req.user!.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : undefined,
      profile: { upsert: { create: profile, update: profile } },
    },
  });
  await getOrCreateUserWallet(prisma, req.user!.id, 'TZS');
  res.status(201).json(await loadMe(req.user!.id));
});

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'Your PIN must be 4 to 6 digits'),
  currentPin: z.string().regex(/^\d{4,6}$/).optional(),
});

/** Set the transaction PIN, or change it (needs the current PIN). */
meRouter.put('/pin', async (req, res) => {
  const { pin, currentPin } = pinSchema.parse(req.body);
  await setPin(req.user!.id, pin, currentPin);
  res.status(204).end();
});

/**
 * Check the PIN to unlock the app on open. Same lockout as payments: wrong attempts count
 * towards PIN_LOCKED, so this cannot be used to guess a PIN faster than paying would.
 */
meRouter.post('/pin/verify', async (req, res) => {
  const { pin } = pinSchema.pick({ pin: true }).parse(req.body);
  await verifyPin(req.user!.id, pin);
  res.status(204).end();
});
