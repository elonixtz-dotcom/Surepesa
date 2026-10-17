import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  NEON_AUTH_BASE_URL: z.string().url(),
  NEON_AUTH_JWKS_URL: z.string().url(),
  AWS_ENDPOINT_URL_S3: z.string().url(),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  ADMIN_JWT_SECRET: z.string().min(32),
  KYC_BUCKET: z.string().min(1).default('kyc-documents'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  // Signs callbacks from the simulated rail. The default is only acceptable outside production.
  SIMULATED_WEBHOOK_SECRET: z.string().min(32).default('dev-only-simulated-webhook-secret-change-me'),
  // How often the API asks rails about unresolved deposits/withdrawals. 0 disables the loop
  // (run `npm run rail-sync` from a scheduler instead).
  RAIL_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; unset = the cron route is disabled.
  CRON_SECRET: z.string().min(16).optional(),
  // Who may move money through the simulated rail (which approves every deposit):
  //   open      anyone (local development)
  //   verified  only customers whose identity staff approved (default in production, so a public
  //             deployment cannot be used to create balances just by signing up)
  //   off       nobody (real rails connected)
  SIMULATED_RAILS: z.enum(['open', 'verified', 'off']).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
if (parsed.data.NODE_ENV === 'production' && parsed.data.SIMULATED_WEBHOOK_SECRET.startsWith('dev-only')) {
  console.error('Invalid environment configuration: set SIMULATED_WEBHOOK_SECRET in production');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  SIMULATED_RAILS: parsed.data.SIMULATED_RAILS ?? (parsed.data.NODE_ENV === 'production' ? 'verified' : 'open'),
} as const;
