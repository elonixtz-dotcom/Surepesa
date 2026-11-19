import express, { Router } from 'express';
import { findVoiceCarrier } from '../providers';
import { InvalidVoiceEventError } from '../providers/voice-carrier';
import { handleVoiceEvent } from '../modules/pushbill/pushbill.service';

/**
 * Inbound voice-carrier events: POST /v1/webhooks/voice/:provider (blueprint §6).
 *
 * Same discipline as payment callbacks: mounted before the global JSON parser so the
 * signature is verified over the raw bytes; no user auth — the carrier signature is the
 * authentication; unknown carriers are rejected; redeliveries are no-ops.
 */
export const voiceWebhooksRouter = Router();

voiceWebhooksRouter.post(
  '/:provider',
  express.raw({ type: () => true, limit: '64kb' }),
  async (req, res) => {
    const carrier = findVoiceCarrier(String(req.params.provider).toUpperCase());
    if (!carrier) {
      res.status(404).json({ error: { code: 'UNKNOWN_CARRIER', message: 'Unknown voice carrier' } });
      return;
    }
    let event;
    try {
      event = carrier.parseEvent(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers);
    } catch (err) {
      if (err instanceof InvalidVoiceEventError) {
        console.warn(`Rejected ${carrier.name} voice event: ${err.message}`);
        res.status(401).json({ error: { code: 'INVALID_EVENT', message: 'Event could not be verified' } });
        return;
      }
      throw err;
    }
    res.json({ received: true, ...(await handleVoiceEvent(carrier, event)) });
  },
);
