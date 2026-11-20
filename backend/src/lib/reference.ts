import { randomInt } from 'node:crypto';

// Crockford base32 without I, L, O, U — unambiguous when read out over the phone.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Customer-facing transaction id, e.g. SPX-7K2M9QX4TB (32^10 ≈ 1.1e15 combinations). */
export const newTransactionReference = () => `SPX-${randomCode(10)}`;

/** Public merchant id printed on QR stickers, e.g. SPM4K9X2Q. */
export const newMerchantCode = () => `SPM${randomCode(6)}`;

/** Opaque token encoded in QR codes. */
export const newQrToken = () => randomCode(20);

/** Customer-facing PushBill session id, e.g. PB-7K2M9QX4 (32^8 ≈ 1.1e12 combinations). */
export const newPushBillReference = () => `PB-${randomCode(8)}`;

/** Customer-facing Circle id, e.g. CIR-7K2M9QX4. */
export const newCircleReference = () => `CIR-${randomCode(8)}`;

/** Opaque Circle invitation accept token. */
export const newCircleInviteToken = () => randomCode(16);

/** Customer-facing Escrow case id, e.g. ESC-7K2M9QX4. */
export const newEscrowReference = () => `ESC-${randomCode(8)}`;

/** Customer-facing cross-border transfer id, e.g. XBT-7K2M9QX4. */
export const newCrossBorderReference = () => `XBT-${randomCode(8)}`;
