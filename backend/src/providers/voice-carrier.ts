/**
 * Voice carrier contract (blueprint §11, Voice Gateway).
 *
 * A carrier bridges an ordinary cellular call between two verified mobile numbers for
 * PushBill. It reports leg/bridge states through signature-verified webhooks. Call audio is
 * never recorded or stored by SurePesa, and an answered call is never by itself payment
 * consent — the payer authorises afterwards, in the app or a fresh USSD session.
 */
import { AppError } from '../lib/errors';

export type VoiceEventStatus = 'RINGING' | 'CONNECTED' | 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'FAILED';

export interface VoiceCallEvent {
  eventId: string;
  providerCallId: string;
  status: VoiceEventStatus;
  failureCode?: string;
  failureReason?: string;
}

export interface VoiceBridgeRequest {
  /** PushBill session reference, echoed back so events can be matched. */
  sessionReference: string;
  requesterPhone: string; // E.164
  payerPhone: string; // E.164
}

export interface VoiceBridge {
  providerCallId: string;
}

export interface VoiceCarrier {
  readonly name: string;
  /** Ask the carrier to ring both numbers and bridge them. */
  startBridge(req: VoiceBridgeRequest): Promise<VoiceBridge>;
  /** Verify and parse an inbound webhook. Throws InvalidVoiceEventError on any doubt. */
  parseEvent(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VoiceCallEvent;
}

/** A webhook that fails verification must never change call or session state. */
export class InvalidVoiceEventError extends AppError {
  constructor(message: string) {
    super('INVALID_VOICE_EVENT', message, 401);
  }
}
