import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { jsonReplacer } from './lib/json';
import { errorHandler, notFound } from './middleware/error-handler';
import { healthRouter } from './routes/health.routes';
import { meRouter } from './routes/me.routes';
import { kycRouter } from './routes/kyc.routes';
import { adminRouter } from './admin/router';
import { providerCallbacksRouter } from './routes/provider-callbacks.routes';
import { paymentsRouter } from './routes/payments.routes';
import { qrRouter } from './routes/qr.routes';
import { merchantRouter } from './routes/merchant.routes';
import { cardsRouter } from './routes/cards.routes';
import { cronRouter } from './routes/cron.routes';
import { authProxyRouter } from './routes/auth-proxy.routes';
import { voiceWebhooksRouter } from './routes/voice-webhooks.routes';
import { cardWebhooksRouter } from './routes/card-webhooks.routes';
import { onlineServicesRouter } from './routes/online-services.routes';
import { pushBillRouter } from './modules/pushbill/pushbill.routes';
import { circlesRouter } from './modules/circles/circles.routes';
import { escrowRouter } from './modules/escrow/escrow.routes';
import { borderlessRouter } from './modules/borderless/borderless.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('json replacer', jsonReplacer);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false }));
  // Provider callbacks need the raw body for signature checks: mount before the JSON parser.
  app.use('/v1/providers', providerCallbacksRouter);
  // Voice-carrier events likewise need the raw body (PushBill call state).
  app.use('/v1/webhooks/voice', voiceWebhooksRouter);
  // Card-issuer events (authorisations, reversals, refunds) need the raw body too.
  app.use('/v1/webhooks/cards', cardWebhooksRouter);
  // Neon Auth for the web portals, before the JSON parser so bodies pass through untouched.
  app.use('/auth', authProxyRouter);
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter);
  app.use('/api/cron', cronRouter);
  app.use('/v1/me', meRouter);
  app.use('/v1/kyc', kycRouter);
  app.use('/v1/merchants', qrRouter); // static QR is public: must come before paymentsRouter's auth
  app.use('/v1/merchant', merchantRouter);
  app.use('/v1/cards', cardsRouter);
  app.use('/v1/online-services', onlineServicesRouter);
  app.use('/v1/pushbills', pushBillRouter);
  app.use('/v1/circles', circlesRouter);
  app.use('/v1/escrow', escrowRouter);
  app.use('/v1/borderless', borderlessRouter);
  app.use('/v1', paymentsRouter);
  app.use('/admin/v1', adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
