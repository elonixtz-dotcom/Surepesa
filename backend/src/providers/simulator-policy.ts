import { User } from '@prisma/client';
import { PaymentRejectedError } from '../lib/errors';

export type SimulatedRailsMode = 'open' | 'verified' | 'off';

/**
 * The simulated rail approves every deposit, so on a reachable deployment it would let anyone
 * create a balance by signing up. This decides who may use it (see SIMULATED_RAILS in env.ts).
 */
export function assertSimulatorAllowed(mode: SimulatedRailsMode, user: Pick<User, 'kycStatus'>): void {
  if (mode === 'off') {
    throw new PaymentRejectedError('SIMULATOR_DISABLED', 'Test payments are switched off on this server');
  }
  if (mode === 'verified' && user.kycStatus !== 'APPROVED') {
    throw new PaymentRejectedError('KYC_REQUIRED', 'Verify your identity before adding money');
  }
}
