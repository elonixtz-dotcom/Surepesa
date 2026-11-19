import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AccountLookup,
  InvalidCallbackError,
  PaymentProvider,
  ProviderCallback,
  ProviderResult,
  ProviderStatus,
  StatusQuery,
} from './payment-provider';

/**
 * Stand-in rail for the prototype. It behaves like a real asynchronous rail so the engine's
 * pending, timeout and callback paths are exercised before any real money moves.
 *
 * Behaviour is chosen by the last four digits of the account number:
 *
 * | Ends in | First response        | Later (query or callback)          |
 * | ------- | --------------------- | ---------------------------------- |
 * | 0000    | FAILED                | —                                  |
 * | 1111    | PENDING               | SUCCESS (customer approved)        |
 * | 2222    | AMBIGUOUS             | SUCCESS                            |
 * | 3333    | throws (timeout)      | SUCCESS (money moved anyway)       |
 * | 4444    | PENDING               | FAILED (customer rejected)         |
 * | 5555    | PENDING               | PENDING forever (needs escalation) |
 * | 9999    | lookupAccount invalid | —                                  |
 * | other   | SUCCESS               | SUCCESS                            |
 */
export class SimulatedProvider implements PaymentProvider {
  readonly name = 'SIMULATED';
  static readonly SIGNATURE_HEADER = 'x-simulated-signature';
  /** Callbacks older or newer than this are rejected as possible replays. */
  static readonly TOLERANCE_SECONDS = 300;

  constructor(private readonly webhookSecret: string) {}

  async collect(req: { reference: string; accountNumber: string }): Promise<ProviderResult> {
    return this.firstResponse(req.reference, req.accountNumber);
  }

  async payout(req: { reference: string; accountNumber: string }): Promise<ProviderResult> {
    return this.firstResponse(req.reference, req.accountNumber);
  }

  async queryStatus(query: StatusQuery): Promise<ProviderResult> {
    const status = SimulatedProvider.finalStatusFor(query.accountNumber);
    return {
      status,
      providerReference: SimulatedProvider.providerReferenceFor(query.reference),
      ...(status === 'FAILED' ? { failureCode: 'SIMULATED_REJECTED', failureReason: 'Customer rejected the request' } : {}),
    };
  }

  async lookupAccount(accountNumber: string): Promise<AccountLookup> {
    if (accountNumber.endsWith('9999')) return { accountName: null, valid: false };
    return { accountName: `SIMULATED CUSTOMER ${accountNumber.slice(-3)}`, valid: true };
  }

  parseCallback(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderCallback {
    const header = headers[SimulatedProvider.SIGNATURE_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) throw new InvalidCallbackError('Missing signature header');

    const parts = Object.fromEntries(value.split(',').map((p) => p.split('=', 2) as [string, string]));
    const timestamp = Number(parts.t);
    if (!Number.isInteger(timestamp) || !parts.v1) throw new InvalidCallbackError('Malformed signature header');
    if (Math.abs(Date.now() / 1000 - timestamp) > SimulatedProvider.TOLERANCE_SECONDS) {
      throw new InvalidCallbackError('Signature timestamp outside tolerance');
    }

    const expected = Buffer.from(this.sign(timestamp, rawBody), 'hex');
    const given = Buffer.from(parts.v1, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new InvalidCallbackError('Signature mismatch');
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidCallbackError('Body is not JSON');
    }
    const status = body.status;
    if (typeof body.event_id !== 'string' || !['SUCCESS', 'FAILED', 'PENDING', 'AMBIGUOUS'].includes(String(status))) {
      throw new InvalidCallbackError('Missing event_id or status');
    }
    return {
      eventId: body.event_id,
      reference: typeof body.reference === 'string' ? body.reference : undefined,
      providerReference: typeof body.provider_reference === 'string' ? body.provider_reference : undefined,
      status: status as ProviderStatus,
      failureCode: typeof body.failure_code === 'string' ? body.failure_code : undefined,
      failureReason: typeof body.failure_reason === 'string' ? body.failure_reason : undefined,
    };
  }

  /** Builds a signed callback, as the simulated rail would send it. For tests and dev tools. */
  signedCallback(
    payload: { reference: string; status: ProviderStatus; eventId?: string; failureCode?: string; failureReason?: string },
    timestamp = Math.floor(Date.now() / 1000),
  ): { body: Buffer; headers: Record<string, string> } {
    const body = Buffer.from(
      JSON.stringify({
        event_id: payload.eventId ?? `evt_${randomUUID()}`,
        reference: payload.reference,
        provider_reference: SimulatedProvider.providerReferenceFor(payload.reference),
        status: payload.status,
        failure_code: payload.failureCode,
        failure_reason: payload.failureReason,
      }),
    );
    return {
      body,
      headers: {
        'content-type': 'application/json',
        [SimulatedProvider.SIGNATURE_HEADER]: `t=${timestamp},v1=${this.sign(timestamp, body)}`,
      },
    };
  }

  static providerReferenceFor(reference: string): string {
    return `SIM-${reference}`;
  }

  /** Where a transaction to this account ends up once the rail has finished with it. */
  static finalStatusFor(accountNumber: string): ProviderStatus {
    if (accountNumber.endsWith('0000') || accountNumber.endsWith('4444')) return 'FAILED';
    if (accountNumber.endsWith('5555')) return 'PENDING';
    return 'SUCCESS';
  }

  private sign(timestamp: number, rawBody: Buffer): string {
    return createHmac('sha256', this.webhookSecret).update(`${timestamp}.`).update(rawBody).digest('hex');
  }

  private firstResponse(reference: string, accountNumber: string): ProviderResult {
    const providerReference = SimulatedProvider.providerReferenceFor(reference);
    if (accountNumber.endsWith('0000')) {
      return { status: 'FAILED', providerReference, failureCode: 'SIMULATED_DECLINE', failureReason: 'Declined by simulated provider' };
    }
    if (accountNumber.endsWith('1111') || accountNumber.endsWith('4444') || accountNumber.endsWith('5555')) {
      return { status: 'PENDING', providerReference };
    }
    if (accountNumber.endsWith('2222')) return { status: 'AMBIGUOUS' };
    if (accountNumber.endsWith('3333')) throw new Error('Simulated provider timeout');
    return { status: 'SUCCESS', providerReference };
  }
}
