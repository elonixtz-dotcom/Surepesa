import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { simulatedCardIssuer } from '../providers';
import { handleCardEvent, loadOwnCard } from '../services/card.service';
import { verifyPin } from '../services/pin.service';

/**
 * Online services (blueprint §9): /v1/online-services
 *
 * A catalogue of online subscriptions/services payable with a SurePesa virtual card.
 * A payment intent asks the card issuer for an authorisation through exactly the same
 * verified webhook path a real issuer uses, so the decision, the ledger movement and the
 * card history are identical to a production online purchase.
 */
export const onlineServicesRouter = Router();
onlineServicesRouter.use(requireAuth);

const pin = z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit PIN');

/** Prototype catalogue. Real partners plug in here without schema changes. */
const CATALOGUE = [
  { id: 'netflix-standard', name: 'Netflix Standard', category: 'STREAMING', priceMinor: '4500000', currencyCode: 'TZS', period: 'monthly' },
  { id: 'spotify-premium', name: 'Spotify Premium', category: 'MUSIC', priceMinor: '1500000', currencyCode: 'TZS', period: 'monthly' },
  { id: 'dstv-compact', name: 'DStv Compact', category: 'TV', priceMinor: '6200000', currencyCode: 'TZS', period: 'monthly' },
  { id: 'startimes-nova', name: 'StarTimes Nova', category: 'TV', priceMinor: '1200000', currencyCode: 'TZS', period: 'monthly' },
  { id: 'youtube-premium', name: 'YouTube Premium', category: 'STREAMING', priceMinor: '1900000', currencyCode: 'TZS', period: 'monthly' },
  { id: 'chatgpt-plus', name: 'ChatGPT Plus', category: 'AI', priceMinor: '5000000', currencyCode: 'TZS', period: 'monthly' },
] as const;

onlineServicesRouter.get('/', (_req, res) => {
  res.json({ items: CATALOGUE });
});

/** Pay for a service with one of the user's virtual cards (PIN required). */
onlineServicesRouter.post('/:serviceId/payment-intents', async (req, res) => {
  const { cardId, pin: p } = z.object({ cardId: z.string().uuid(), pin }).parse(req.body);
  const service = CATALOGUE.find((s) => s.id === req.params.serviceId);
  if (!service) throw new AppError('SERVICE_NOT_FOUND', 'Unknown online service', 404);

  await verifyPin(req.user!.id, p);
  const card = await loadOwnCard(req.user!.id, cardId);
  if (card.status !== 'ACTIVE') throw new AppError('CARD_NOT_ACTIVE', 'This card is not active', 409);
  if (card.issuerName !== simulatedCardIssuer.name || !card.issuerCardId) {
    throw new AppError('ISSUER_UNSUPPORTED', 'This service only supports sandbox cards for now', 422);
  }

  // The issuer authorisation flows through the same verified path as a real webhook.
  const signed = simulatedCardIssuer.signedEvent({
    kind: 'AUTHORIZATION',
    issuerCardId: card.issuerCardId,
    amount: BigInt(service.priceMinor),
    merchantName: service.name,
    merchantCountry: 'US',
  });
  const decision = await handleCardEvent(card.issuerName, simulatedCardIssuer.parseEvent(signed.body, signed.headers));
  res.status(201).json({
    service: { id: service.id, name: service.name },
    cardId: card.id,
    decision,
    authId: signed.authId,
  });
});
