import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { PaymentProvider } from './payment-provider';
import { SimulatedProvider } from './simulated.provider';
import { CardIssuer } from './card-issuer';
import { SimulatedCardIssuer } from './simulated-card-issuer';
import { VoiceCarrier } from './voice-carrier';
import { SimulatedVoiceCarrier } from './simulated-voice.carrier';

export const simulatedProvider = new SimulatedProvider(env.SIMULATED_WEBHOOK_SECRET);

const providers = new Map<string, PaymentProvider>([[simulatedProvider.name, simulatedProvider]]);

/**
 * Resolves the adapter for a payment method's provider.
 *
 * Fail closed (blueprint §4.3): an unconfigured provider is never silently rerouted to the
 * simulator. The only exception is the explicit development/test escape hatch
 * SIMULATE_UNCONFIGURED_PROVIDERS, which env.ts forces off in production. When
 * SIMULATED_RAILS=off (real rails connected) even an explicit SIMULATED request is refused.
 */
export function getProvider(name: string): PaymentProvider {
  const provider =
    providers.get(name) ?? (env.SIMULATE_UNCONFIGURED_PROVIDERS ? simulatedProvider : undefined);
  if (!provider) {
    throw new AppError('PROVIDER_UNAVAILABLE', `Provider ${name} is not configured on this server`, 503);
  }
  if (provider.name === simulatedProvider.name && env.SIMULATED_RAILS === 'off') {
    throw new AppError('PROVIDER_UNAVAILABLE', 'The simulated provider is disabled on this server', 503);
  }
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

// ── Voice carriers ──
export const simulatedVoiceCarrier = new SimulatedVoiceCarrier(env.SIMULATED_WEBHOOK_SECRET);
const voiceCarriers = new Map<string, VoiceCarrier>([[simulatedVoiceCarrier.name, simulatedVoiceCarrier]]);

/**
 * Resolves the carrier for a voice bridge. Same fail-closed rule as payment providers:
 * unconfigured names only reach the simulator through the development/test escape hatch.
 */
export function getVoiceCarrier(name: string): VoiceCarrier {
  const carrier =
    voiceCarriers.get(name) ?? (env.SIMULATE_UNCONFIGURED_PROVIDERS ? simulatedVoiceCarrier : undefined);
  if (!carrier) {
    throw new AppError('VOICE_CARRIER_UNAVAILABLE', `Voice carrier ${name} is not configured on this server`, 503);
  }
  if (carrier.name === simulatedVoiceCarrier.name && env.SIMULATED_RAILS === 'off') {
    throw new AppError('VOICE_CARRIER_UNAVAILABLE', 'The simulated voice carrier is disabled on this server', 503);
  }
  return carrier;
}

/** Exact lookup for inbound voice webhooks: no fallback, an unknown name is rejected. */
export const findVoiceCarrier = (name: string) => voiceCarriers.get(name);

export type { VoiceCarrier, VoiceCallEvent } from './voice-carrier';
export { InvalidVoiceEventError } from './voice-carrier';
