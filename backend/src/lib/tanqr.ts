/**
 * TANQR merchant-presented QR payloads.
 *
 * The Bank of Tanzania's TANQR Code Standard (2022) is built on the EMVCo QR Code Specification
 * for Payment Systems, Merchant-Presented Mode (EMV QRCPS-MPM). A payload is a flat string of
 * TLV data objects: a 2-digit tag, a 2-digit length (in characters) and the value. Templates
 * (merchant account info, additional data) nest the same TLV format inside their value. The
 * payload always ends with tag 63, a CRC-16/CCITT-FALSE over everything before its value.
 *
 * This module is pure (no I/O) so it can be unit tested and reused by the app and the back office.
 *
 * ⚠ BoT-SPEC: values marked with this tag follow plain EMVCo or are SurePesa placeholders. They
 * must be confirmed against the official TANQR Code Standard before merchant QR goes live.
 */

// ───────────────────────────── Tags ─────────────────────────────

export const TAG = {
  PAYLOAD_FORMAT: '00',
  POINT_OF_INITIATION: '01',
  MERCHANT_CATEGORY_CODE: '52',
  CURRENCY: '53',
  AMOUNT: '54',
  COUNTRY: '58',
  MERCHANT_NAME: '59',
  MERCHANT_CITY: '60',
  POSTAL_CODE: '61',
  ADDITIONAL_DATA: '62',
  CRC: '63',
} as const;

/** Sub-tags of the additional data field template (tag 62), per EMVCo. */
export const ADDITIONAL_TAG = {
  BILL_NUMBER: '01',
  STORE_LABEL: '03',
  REFERENCE_LABEL: '05',
  TERMINAL_LABEL: '07',
  PURPOSE: '08',
} as const;

export const PAYLOAD_FORMAT_INDICATOR = '01';
export const POINT_OF_INITIATION = { STATIC: '11', DYNAMIC: '12' } as const;

/** ISO 4217 numeric code for the Tanzanian shilling. */
export const CURRENCY_TZS = '834';
/** ISO 3166-1 alpha-2. */
export const COUNTRY_TZ = 'TZ';

/**
 * Merchant account information template SurePesa publishes under.
 * EMVCo reserves 02–25 for card schemes and 26–51 for other payment systems; each 26–51
 * template carries a globally unique identifier in sub-tag 00 and the merchant id in 01+.
 *
 * ⚠ BoT-SPEC: TANQR may assign a fixed tag (and its own GUID or acquirer id) to Tanzanian
 * PSPs, or route everything through a national switch template (e.g. TIPS). Both the tag and
 * the GUID below are SurePesa placeholders until confirmed.
 */
export const SUREPESA_ACCOUNT_TAG = '26';
export const SUREPESA_GUID = 'TZ.CO.SUREPESA'; // ⚠ BoT-SPEC placeholder
export const ACCOUNT_SUBTAG = { GUID: '00', MERCHANT_CODE: '01' } as const;

/**
 * Fallback merchant category code (ISO 18245) when a business has no mapped MCC.
 * 5999 = miscellaneous retail. ⚠ BoT-SPEC: confirm whether TANQR mandates real MCCs or a
 * national category list, and map `Business.category` accordingly.
 */
export const DEFAULT_MCC = '5999';

// ─────────────────────────── Errors ────────────────────────────

export class TanqrError extends Error {
  constructor(
    public readonly code:
      | 'MALFORMED_TLV'
      | 'DUPLICATE_TAG'
      | 'MISSING_TAG'
      | 'INVALID_VALUE'
      | 'CRC_MISMATCH'
      | 'NOT_SUREPESA',
    message: string,
  ) {
    super(message);
    this.name = 'TanqrError';
  }
}

// ──────────────────────────── CRC ──────────────────────────────

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final XOR) over the UTF-8
 * bytes of `data`, as 4 uppercase hex digits. EMVCo computes it over the whole payload up to
 * and including the "6304" tag and length of the CRC field itself.
 */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(data, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ──────────────────────────── TLV ──────────────────────────────

export interface TlvField {
  tag: string;
  value: string;
}

/** EMVCo lengths count characters, not bytes or UTF-16 code units. */
const charLength = (s: string) => [...s].length;

function tlv(tag: string, value: string): string {
  const length = charLength(value);
  if (length < 1 || length > 99) {
    throw new TanqrError('INVALID_VALUE', `Tag ${tag} must be 1–99 characters, got ${length}`);
  }
  return `${tag}${String(length).padStart(2, '0')}${value}`;
}

/** Splits a TLV string into fields, in order. Rejects anything that is not well-formed TLV. */
export function parseTlv(data: string): TlvField[] {
  const chars = [...data];
  const fields: TlvField[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < chars.length) {
    const tag = chars.slice(i, i + 2).join('');
    const len = chars.slice(i + 2, i + 4).join('');
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(len)) {
      throw new TanqrError('MALFORMED_TLV', `Bad tag or length at position ${i}`);
    }
    const length = Number(len);
    if (length === 0 || i + 4 + length > chars.length) {
      throw new TanqrError('MALFORMED_TLV', `Tag ${tag} declares length ${length} past the end of the data`);
    }
    if (seen.has(tag)) throw new TanqrError('DUPLICATE_TAG', `Tag ${tag} appears more than once`);
    seen.add(tag);
    fields.push({ tag, value: chars.slice(i + 4, i + 4 + length).join('') });
    i += 4 + length;
  }
  return fields;
}

// ─────────────────────────── Model ─────────────────────────────

export type QrType = 'STATIC' | 'DYNAMIC';

export interface TanqrAdditionalData {
  billNumber?: string;
  storeLabel?: string;
  /** For DYNAMIC codes SurePesa puts the QrCode.token here so a scan resolves to that row. */
  referenceLabel?: string;
  terminalLabel?: string;
  purpose?: string;
}

export interface TanqrMerchant {
  type: QrType;
  /** SurePesa public merchant code, e.g. SPM4K9X2Q. */
  merchantCode: string;
  merchantName: string;
  merchantCity: string;
  mcc?: string;
  /** Decimal string in major units ("2500" or "2500.50"); required for DYNAMIC, absent for STATIC. */
  amount?: string;
  currency?: string;
  country?: string;
  postalCode?: string;
  additionalData?: TanqrAdditionalData;
}

export interface DecodedTanqr extends Required<Pick<TanqrMerchant, 'type' | 'merchantName' | 'merchantCity' | 'mcc' | 'currency' | 'country'>> {
  /** SurePesa merchant code, or undefined when the QR belongs to another PSP. */
  merchantCode?: string;
  amount?: string;
  postalCode?: string;
  additionalData: TanqrAdditionalData;
  /** Every merchant account template (tags 02–51) as raw values, keyed by tag. */
  merchantAccounts: Record<string, string>;
  /** All top-level fields, for anything this module does not model. */
  fields: TlvField[];
}

const AMOUNT_RE = /^(?!0+(\.0*)?$)\d{1,10}(\.\d{1,2})?$/;
const ADDITIONAL_KEYS: [keyof TanqrAdditionalData, string][] = [
  ['billNumber', ADDITIONAL_TAG.BILL_NUMBER],
  ['storeLabel', ADDITIONAL_TAG.STORE_LABEL],
  ['referenceLabel', ADDITIONAL_TAG.REFERENCE_LABEL],
  ['terminalLabel', ADDITIONAL_TAG.TERMINAL_LABEL],
  ['purpose', ADDITIONAL_TAG.PURPOSE],
];

function invalid(message: string): never {
  throw new TanqrError('INVALID_VALUE', message);
}

/** EMVCo: name up to 25 characters, city up to 15. Strip characters scanners choke on. */
function clean(value: string, max: number): string {
  return value.replace(/[^\x20-\x7E]/g, '').trim().slice(0, max).trim();
}

// ─────────────────────────── Encode ────────────────────────────

/** Builds the full TANQR payload string, CRC included. */
export function encodeTanqr(m: TanqrMerchant): string {
  const mcc = m.mcc ?? DEFAULT_MCC;
  const currency = m.currency ?? CURRENCY_TZS;
  const country = m.country ?? COUNTRY_TZ;
  const name = clean(m.merchantName, 25);
  const city = clean(m.merchantCity, 15);

  if (!/^[A-Z0-9]{3,20}$/.test(m.merchantCode)) invalid('Merchant code must be 3–20 uppercase letters or digits');
  if (!/^\d{4}$/.test(mcc)) invalid('MCC must be 4 digits');
  if (!/^\d{3}$/.test(currency)) invalid('Currency must be a 3-digit ISO 4217 code');
  if (!/^[A-Z]{2}$/.test(country)) invalid('Country must be a 2-letter ISO 3166 code');
  if (!name) invalid('Merchant name is required');
  if (!city) invalid('Merchant city is required');
  if (m.type === 'DYNAMIC') {
    if (m.amount === undefined || !AMOUNT_RE.test(m.amount)) invalid('A dynamic QR needs a positive amount like "2500" or "2500.50"');
  } else if (m.amount !== undefined) {
    invalid('A static QR carries no amount; the payer enters it');
  }

  const account =
    tlv(ACCOUNT_SUBTAG.GUID, SUREPESA_GUID) + tlv(ACCOUNT_SUBTAG.MERCHANT_CODE, m.merchantCode);

  let additional = '';
  for (const [key, tag] of ADDITIONAL_KEYS) {
    const value = m.additionalData?.[key];
    if (value !== undefined && value !== '') additional += tlv(tag, clean(value, 25) || invalid(`${key} is empty after cleaning`));
  }

  let payload =
    tlv(TAG.PAYLOAD_FORMAT, PAYLOAD_FORMAT_INDICATOR) +
    tlv(TAG.POINT_OF_INITIATION, POINT_OF_INITIATION[m.type]) +
    tlv(SUREPESA_ACCOUNT_TAG, account) +
    tlv(TAG.MERCHANT_CATEGORY_CODE, mcc) +
    tlv(TAG.CURRENCY, currency) +
    (m.amount !== undefined ? tlv(TAG.AMOUNT, m.amount) : '') +
    tlv(TAG.COUNTRY, country) +
    tlv(TAG.MERCHANT_NAME, name) +
    tlv(TAG.MERCHANT_CITY, city) +
    (m.postalCode ? tlv(TAG.POSTAL_CODE, m.postalCode) : '') +
    (additional ? tlv(TAG.ADDITIONAL_DATA, additional) : '');

  payload += `${TAG.CRC}04`;
  return payload + crc16(payload);
}

// ─────────────────────────── Decode ────────────────────────────

/**
 * Parses and validates any EMVCo merchant-presented payload (SurePesa's or another PSP's).
 * Verifies the CRC before trusting anything else, and rejects malformed TLV, duplicate or
 * missing mandatory tags. `merchantCode` is set only when the SurePesa template is present.
 */
export function decodeTanqr(payload: string): DecodedTanqr {
  const data = payload.trim();
  if (!/6304[0-9A-Fa-f]{4}$/.test(data)) throw new TanqrError('MISSING_TAG', 'Payload must end with the CRC field (63)');
  const expected = data.slice(-4).toUpperCase();
  if (crc16(data.slice(0, -4)) !== expected) throw new TanqrError('CRC_MISMATCH', 'QR checksum does not match; the code is damaged or altered');

  const fields = parseTlv(data);
  const byTag = new Map(fields.map((f) => [f.tag, f.value]));
  const required = (tag: string) => byTag.get(tag) ?? (() => { throw new TanqrError('MISSING_TAG', `Mandatory tag ${tag} is missing`); })();

  if (fields[0]?.tag !== TAG.PAYLOAD_FORMAT) throw new TanqrError('MALFORMED_TLV', 'Payload must start with tag 00');
  if (fields[fields.length - 1]?.tag !== TAG.CRC) throw new TanqrError('MALFORMED_TLV', 'CRC (63) must be the last field');
  if (required(TAG.PAYLOAD_FORMAT) !== PAYLOAD_FORMAT_INDICATOR) invalid('Unsupported payload format indicator');

  const poi = byTag.get(TAG.POINT_OF_INITIATION);
  if (poi !== undefined && poi !== POINT_OF_INITIATION.STATIC && poi !== POINT_OF_INITIATION.DYNAMIC) {
    invalid(`Unknown point of initiation "${poi}"`);
  }
  const type: QrType = poi === POINT_OF_INITIATION.DYNAMIC ? 'DYNAMIC' : 'STATIC';

  const merchantAccounts: Record<string, string> = {};
  for (const f of fields) {
    const n = Number(f.tag);
    if (n >= 2 && n <= 51) merchantAccounts[f.tag] = f.value;
  }
  if (Object.keys(merchantAccounts).length === 0) throw new TanqrError('MISSING_TAG', 'No merchant account information (tags 02–51)');

  let merchantCode: string | undefined;
  for (const [tag, value] of Object.entries(merchantAccounts)) {
    if (Number(tag) < 26) continue; // 02–25 are primitive card-scheme ids, not templates
    const sub = new Map(parseTlv(value).map((f) => [f.tag, f.value]));
    if (sub.get(ACCOUNT_SUBTAG.GUID)?.toUpperCase() === SUREPESA_GUID) {
      merchantCode = sub.get(ACCOUNT_SUBTAG.MERCHANT_CODE);
      if (!merchantCode) throw new TanqrError('MISSING_TAG', 'SurePesa template has no merchant code');
    }
  }

  const mcc = required(TAG.MERCHANT_CATEGORY_CODE);
  const currency = required(TAG.CURRENCY);
  const country = required(TAG.COUNTRY);
  const amount = byTag.get(TAG.AMOUNT);
  if (!/^\d{4}$/.test(mcc)) invalid('MCC must be 4 digits');
  if (!/^\d{3}$/.test(currency)) invalid('Currency must be 3 digits');
  if (!/^[A-Z]{2}$/.test(country)) invalid('Country must be 2 letters');
  if (amount !== undefined && !/^\d+(\.\d+)?$/.test(amount)) invalid(`Invalid amount "${amount}"`);

  const additionalData: TanqrAdditionalData = {};
  const additional = byTag.get(TAG.ADDITIONAL_DATA);
  if (additional !== undefined) {
    const sub = new Map(parseTlv(additional).map((f) => [f.tag, f.value]));
    for (const [key, tag] of ADDITIONAL_KEYS) {
      const value = sub.get(tag);
      if (value !== undefined) additionalData[key] = value;
    }
  }

  return {
    type,
    merchantCode,
    merchantName: required(TAG.MERCHANT_NAME),
    merchantCity: required(TAG.MERCHANT_CITY),
    mcc,
    currency,
    country,
    amount,
    postalCode: byTag.get(TAG.POSTAL_CODE),
    additionalData,
    merchantAccounts,
    fields,
  };
}
