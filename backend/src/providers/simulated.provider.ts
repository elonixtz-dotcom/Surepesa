import { randomUUID } from 'node:crypto';
import { PaymentProvider, ProviderResult } from './payment-provider';

/**
 * Stand-in rail for the prototype. Always succeeds immediately unless the account number
 * ends in "0000" (handy for demonstrating failures). Real rails usually return PENDING and
 * confirm later through a webhook.
 */
export class SimulatedProvider implements PaymentProvider {
  readonly name = 'SIMULATED';

  async collect(req: { accountNumber: string }): Promise<ProviderResult> {
    return this.respond(req.accountNumber);
  }

  async payout(req: { accountNumber: string }): Promise<ProviderResult> {
    return this.respond(req.accountNumber);
  }

  private respond(accountNumber: string): ProviderResult {
    const providerReference = `SIM-${randomUUID()}`;
    if (accountNumber.endsWith('0000')) {
      return { status: 'FAILED', providerReference, failureCode: 'SIMULATED_DECLINE', failureReason: 'Declined by simulated provider' };
    }
    return { status: 'SUCCESS', providerReference };
  }
}
