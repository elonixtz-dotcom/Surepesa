import express, { Router } from 'express';
import { findCardIssuer } from '../providers';
import { handleCardEvent } from '../services/card.service';

/**
 * Inbound card-issuer events: POST /v1/webhooks/cards/:issuer (blueprint §9).
 *
 * Mounted before the global JSON parser so the signature is verified over the raw bytes.
 * No user auth — the issuer signature is the authentication; unknown issuers are
 * rejected; redeliveries are stored once and are no-ops.
 */
export const cardWebhooksRouter = Router();

cardWebhooksRouter.post(
  '/:issuer',
  express.raw({ type: () => true, limit: '64kb' }),
  async (req, res) => {
    const issuer = findCardIssuer(String(req.params.issuer).toUpperCase());
    if (!issuer) {
      res.status(404).json({ error: { code: 'UNKNOWN_ISSUER', message: 'Unknown card issuer' } });
      return;
    }
    try {
      const event = issuer.parseEvent(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers);
      res.json({ received: true, ...(await handleCardEvent(issuer.name, event)) });
    } catch {
      res.status(401).json({ error: { code: 'INVALID_EVENT', message: 'Event could not be verified' } });
    }
  },
);
