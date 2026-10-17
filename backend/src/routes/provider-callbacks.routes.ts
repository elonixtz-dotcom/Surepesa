import express, { Router } from 'express';
import { findProvider } from '../providers';
import { InvalidCallbackError } from '../providers/payment-provider';
import { handleProviderCallback } from '../services/rail-sync.service';

/**
 * Inbound callbacks from payment rails: POST /v1/providers/:provider/callbacks
 *
 * Mounted before the global JSON parser: signatures are computed over the exact raw bytes,
 * so the body must not be parsed and re-serialised. No user auth — the provider signature
 * is the authentication. Answers 2xx quickly for anything we have stored, so the rail stops
 * retrying; 401 for anything we could not verify.
 */
export const providerCallbacksRouter = Router();

providerCallbacksRouter.post(
  '/:provider/callbacks',
  express.raw({ type: () => true, limit: '64kb' }),
  async (req, res) => {
    const provider = findProvider(String(req.params.provider).toUpperCase());
    if (!provider) {
      res.status(404).json({ error: { code: 'UNKNOWN_PROVIDER', message: 'Unknown provider' } });
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    let callback;
    try {
      callback = provider.parseCallback(rawBody, req.headers);
    } catch (err) {
      if (err instanceof InvalidCallbackError) {
        console.warn(`Rejected ${provider.name} callback: ${err.message}`);
        res.status(401).json({ error: { code: 'INVALID_CALLBACK', message: 'Callback could not be verified' } });
        return;
      }
      throw err;
    }

    const outcome = await handleProviderCallback(provider.name, callback);
    res.json({ received: true, outcome });
  },
);
