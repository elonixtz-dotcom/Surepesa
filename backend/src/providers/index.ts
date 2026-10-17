import { AppError } from '../lib/errors';
import { PaymentProvider } from './payment-provider';
import { SimulatedProvider } from './simulated.provider';

const providers = new Map<string, PaymentProvider>([['SIMULATED', new SimulatedProvider()]]);

/**
 * Resolves the adapter for a payment method's provider. During the prototype every
 * provider (MPESA_TZ, AIRTEL_TZ, NMB ...) is routed to the simulator.
 */
export function getProvider(name: string): PaymentProvider {
  const provider = providers.get(name) ?? providers.get('SIMULATED');
  if (!provider) throw new AppError('PROVIDER_UNAVAILABLE', `No provider for ${name}`, 503);
  return provider;
}

export type { PaymentProvider } from './payment-provider';
