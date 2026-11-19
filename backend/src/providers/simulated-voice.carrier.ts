import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  InvalidVoiceEventError,
  VoiceBridge,
  VoiceBridgeRequest,
  VoiceCallEvent,
  VoiceCarrier,
  VoiceEventStatus,
} from './voice-carrier';

/**
 * Stand-in voice carrier for development and tests. It "bridges" calls immediately and
 * expects the harness (or a test) to deliver the resulting events through the webhook,
 * signed with the same HMAC scheme as the simulated payment rail. Real carriers
 * (e.g. a PSTN bridging partner) plug in behind the same VoiceCarrier contract.
 */
export class SimulatedVoiceCarrier implements VoiceCarrier {
  readonly name = 'SIMULATED_VOICE';
  static readonly SIGNATURE_HEADER = 'x-simulated-voice-signature';
  static readonly TOLERANCE_SECONDS = 300;
  static readonly STATUSES: readonly VoiceEventStatus[] = [
    'RINGING',
    'CONNECTED',
    'COMPLETED',
    'NO_ANSWER',
    'BUSY',
    'FAILED',
  ];

  constructor(private readonly webhookSecret: string) {}

  async startBridge(_req: VoiceBridgeRequest): Promise<VoiceBridge> {
    return { providerCallId: `sim_call_${randomUUID()}` };
  }

  parseEvent(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VoiceCallEvent {
    const header = headers[SimulatedVoiceCarrier.SIGNATURE_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) throw new InvalidVoiceEventError('Missing signature header');

    const parts = Object.fromEntries(value.split(',').map((p) => p.split('=', 2) as [string, string]));
    const timestamp = Number(parts.t);
    if (!Number.isInteger(timestamp) || !parts.v1) throw new InvalidVoiceEventError('Malformed signature header');
    if (Math.abs(Date.now() / 1000 - timestamp) > SimulatedVoiceCarrier.TOLERANCE_SECONDS) {
      throw new InvalidVoiceEventError('Signature timestamp outside tolerance');
    }

    const expected = Buffer.from(this.sign(timestamp, rawBody), 'hex');
    const given = Buffer.from(parts.v1, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new InvalidVoiceEventError('Signature mismatch');
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidVoiceEventError('Body is not JSON');
    }
    const status = body.status;
    if (
      typeof body.event_id !== 'string' ||
      typeof body.provider_call_id !== 'string' ||
      !SimulatedVoiceCarrier.STATUSES.includes(status as VoiceEventStatus)
    ) {
      throw new InvalidVoiceEventError('Missing event_id, provider_call_id or a valid status');
    }
    return {
      eventId: body.event_id,
      providerCallId: body.provider_call_id,
      status: status as VoiceEventStatus,
      failureCode: typeof body.failure_code === 'string' ? body.failure_code : undefined,
      failureReason: typeof body.failure_reason === 'string' ? body.failure_reason : undefined,
    };
  }

  /** Builds a signed event, as the simulated carrier would send it. For tests and dev tools. */
  signedEvent(
    payload: { providerCallId: string; status: VoiceEventStatus; eventId?: string; failureCode?: string; failureReason?: string },
    timestamp = Math.floor(Date.now() / 1000),
  ): { body: Buffer; headers: Record<string, string> } {
    const body = Buffer.from(
      JSON.stringify({
        event_id: payload.eventId ?? `vevt_${randomUUID()}`,
        provider_call_id: payload.providerCallId,
        status: payload.status,
        failure_code: payload.failureCode,
        failure_reason: payload.failureReason,
      }),
    );
    return {
      body,
      headers: {
        'content-type': 'application/json',
        [SimulatedVoiceCarrier.SIGNATURE_HEADER]: `t=${timestamp},v1=${this.sign(timestamp, body)}`,
      },
    };
  }

  private sign(timestamp: number, rawBody: Buffer): string {
    return createHmac('sha256', this.webhookSecret).update(`${timestamp}.`).update(rawBody).digest('hex');
  }
}
