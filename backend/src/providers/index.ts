import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { PaymentProvider } from './payment-provider';
import { SimulatedProvider } from './simulated.provider';

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
