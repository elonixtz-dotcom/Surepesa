import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { PaymentProvider } from './payment-provider';
import { SimulatedProvider } from './simulated.provider';
import { CardIssuer } from './card-issuer';
import { SimulatedCardIssuer } from './simulated-card-issuer';

export const simulatedProvider = new SimulatedProvider(env.SIMULATED_WEBHOOK_SECRET);

const providers = new Map<string, PaymentProvider>([[simulatedProvider.name, simulatedProvider]]);

/**
 * Resolves the adapter for a payment method's provider. During the prototype every
 * provider (MPESA_TZ, AIRTEL_TZ, NMB ...) is routed to the simulator.
 */
export function getProvider(name: string): PaymentProvider {
  const provider = providers.get(name) ?? providers.get('SIMULATED');
  if (!provider) throw new AppError('PROVIDER_UNAVAILABLE', `No provider for ${name}`, 503);
  return provider;
}

/** Exact lookup for inbound callbacks: no fallback, an unknown name is rejected. */
export function findProvider(name: string): PaymentProvider | undefined {
  return providers.get(name);
}

export type { PaymentProvider } from './payment-provider';

// ── Card issuers ──
// The simulator signs its events with the same dev secret as the simulated rail.
export const simulatedCardIssuer = new SimulatedCardIssuer(env.SIMULATED_WEBHOOK_SECRET);
const cardIssuers = new Map<string, CardIssuer>([[simulatedCardIssuer.name, simulatedCardIssuer]]);

/** The issuer new cards are created with. During the prototype: the simulator. */
export const defaultCardIssuer = (): CardIssuer => simulatedCardIssuer;

export function getCardIssuer(name: string): CardIssuer {
  const issuer = cardIssuers.get(name);
  if (!issuer) throw new AppError('ISSUER_UNAVAILABLE', `No card issuer ${name}`, 503);
  return issuer;
}

export const findCardIssuer = (name: string) => cardIssuers.get(name);
