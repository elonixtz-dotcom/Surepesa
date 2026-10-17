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

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('json replacer', jsonReplacer);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false }));
  // Provider callbacks need the raw body for signature checks: mount before the JSON parser.
  app.use('/v1/providers', providerCallbacksRouter);
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter);
  app.use('/v1/me', meRouter);
  app.use('/v1/kyc', kycRouter);
  app.use('/v1/merchants', qrRouter); // static QR is public: must come before paymentsRouter's auth
  app.use('/v1', paymentsRouter);
  app.use('/admin/v1', adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
