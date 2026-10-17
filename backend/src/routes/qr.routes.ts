import { RequestHandler, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { fromMinorUnits, toMinorUnits } from '../lib/money';
import { newQrToken } from '../lib/reference';
import { DEFAULT_MCC, encodeTanqr, TanqrError } from '../lib/tanqr';
import { requireAuth } from '../middleware/auth';
import { minorUnitsOf } from '../services/receipt.service';

/**
 * Merchant QR payloads in the Bank of Tanzania TANQR (EMVCo merchant-presented) format.
 * Mounted at /v1/merchants, ahead of the payments router (which requires auth on all of /v1).
 *
 *   GET /v1/merchants/:merchantCode/qr           static code: public, deterministic, printable
 *   GET /v1/merchants/:merchantCode/qr?amount=   dynamic code: merchant owner only; records a
 *                                                single-use DYNAMIC QrCode row whose token is
 *                                                carried in the reference label (62/05)
 */
export const qrRouter = Router();

const CURRENCY = 'TZS';
const DYNAMIC_TTL_MS = 15 * 60_000;
// ⚠ BoT-SPEC: Business has no city field yet; region is the closest. Confirm what TANQR expects in tag 60.
const FALLBACK_CITY = 'Tanzania';

const query = z.object({ amount: z.string().trim().min(1).max(20).optional() });

/** Static codes are public; a dynamic code is a payment request only the merchant may create. */
const authForDynamic: RequestHandler = (req, res, next) =>
  req.query.amount === undefined ? next() : requireAuth(req, res, next);

/** Minor units -> TANQR amount: "2500" for whole amounts, "2500.50" otherwise. */
function tanqrAmount(minor: bigint, minorUnits: number): string {
  return fromMinorUnits(minor, minorUnits).replace(/\.0+$/, '');
}

qrRouter.get('/:merchantCode/qr', authForDynamic, async (req, res) => {
  const { amount } = query.parse(req.query);
  const merchantCode = String(req.params.merchantCode).toUpperCase();
  const business = await prisma.business.findUnique({ where: { merchantCode } });
  if (!business || !business.isActive) throw new AppError('MERCHANT_NOT_FOUND', 'No merchant uses this code', 404);

  const base = {
    merchantCode: business.merchantCode,
    merchantName: business.tradingName,
    merchantCity: business.region ?? FALLBACK_CITY,
    mcc: DEFAULT_MCC, // ⚠ BoT-SPEC: map Business.category to an ISO 18245 MCC
  };

  try {
    if (amount === undefined) {
      const payload = encodeTanqr({ ...base, type: 'STATIC' });
      res.json({ type: 'STATIC', merchantCode: business.merchantCode, payload });
      return;
    }

    if (req.user!.id !== business.ownerId) {
      throw new AppError('FORBIDDEN', 'Only the merchant can create a payment request QR', 403);
    }
    const units = await minorUnitsOf(CURRENCY);
    let minor: bigint;
    try {
      minor = toMinorUnits(amount, units);
      if (minor <= 0n) throw new RangeError('not positive');
    } catch {
      throw new AppError('INVALID_AMOUNT', 'Enter a valid amount greater than zero', 400);
    }

    const token = newQrToken();
    const value = tanqrAmount(minor, units);
    // Encode before saving so an invalid amount never leaves an orphan row.
    const payload = encodeTanqr({ ...base, type: 'DYNAMIC', amount: value, additionalData: { referenceLabel: token } });
    const qr = await prisma.qrCode.create({
      data: {
        businessId: business.id,
        type: 'DYNAMIC',
        token,
        amount: minor,
        currencyCode: CURRENCY,
        expiresAt: new Date(Date.now() + DYNAMIC_TTL_MS),
      },
    });
    res.status(201).json({
      type: 'DYNAMIC',
      merchantCode: business.merchantCode,
      qrCodeId: qr.id,
      amount: value,
      currency: CURRENCY,
      expiresAt: qr.expiresAt,
      payload,
    });
  } catch (e) {
    if (e instanceof TanqrError) throw new AppError('INVALID_QR_DATA', e.message, 400);
    throw e;
  }
});
