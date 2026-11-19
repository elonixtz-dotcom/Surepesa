import { AppError } from '../lib/errors';
import { PaymentProvider } from './payment-provider';
import { SimulatedProvider } from './simulated.provider';

const providers = new Map<string, PaymentProvider>([['SIMULATED', new SimulatedProvider()]]);

/**
 * Resolves only explicitly registered adapters. Unknown providers fail closed;
 * real telco/bank names must never silently execute against the simulator.
 */
export function getProvider(name: string): PaymentProvider {
  const provider = providers.get(name);
  if (!provider) throw new AppError('PROVIDER_UNAVAILABLE', `No provider for ${name}`, 503);
  return provider;
}

export type { PaymentProvider } from './payment-provider';
