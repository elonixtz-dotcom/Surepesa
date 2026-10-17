import { describe, expect, it } from 'vitest';
import { crc16, decodeTanqr, encodeTanqr, parseTlv, SUREPESA_GUID, TanqrError, TanqrMerchant } from '../src/lib/tanqr';

// Example payload from EMV QRCPS-MPM (alternate-language template 64 with UTF-8 text).
const EMVCO_EXAMPLE =
  '00020101021229300012D156000000000510A93FO3230Q31280012D15600000001030812345678520441115802CN5914BEST TRANSPORT6007BEIJING64200002ZH0104最佳运输0202北京540523.7253031565502016233030412340603***0708A60086670902ME91320016A0112233449988770708123456786304A13A';

// Brazil's PIX static example (also EMVCo MPM).
const PIX_EXAMPLE =
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

const shop: TanqrMerchant = {
  type: 'STATIC',
  merchantCode: 'SPM4K9X2Q',
  merchantName: 'Mama Neema Shop',
  merchantCity: 'Dar es Salaam',
  mcc: '5411',
};

function expectCode(fn: () => unknown, code: TanqrError['code']) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TanqrError);
    expect((e as TanqrError).code).toBe(code);
    return;
  }
  throw new Error(`expected TanqrError ${code}`);
}

/** Recomputes the CRC so a test can reach checks that run after CRC verification. */
const withCrc = (body: string) => `${body}6304${crc16(`${body}6304`)}`;

describe('crc16 (CRC-16/CCITT-FALSE)', () => {
  it('matches the standard check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('matches published EMVCo-format payloads', () => {
    expect(crc16(EMVCO_EXAMPLE.slice(0, -4))).toBe('A13A');
    expect(crc16(PIX_EXAMPLE.slice(0, -4))).toBe('1D3D');
  });
});

describe('decodeTanqr on third-party payloads', () => {
  it('decodes the EMVCo spec example', () => {
    const d = decodeTanqr(EMVCO_EXAMPLE);
    expect(d.type).toBe('DYNAMIC');
    expect(d.merchantCode).toBeUndefined();
    expect(d.merchantName).toBe('BEST TRANSPORT');
    expect(d.merchantCity).toBe('BEIJING');
    expect(d.amount).toBe('23.72');
    expect(d.currency).toBe('156');
    expect(d.mcc).toBe('4111');
    expect(d.additionalData).toEqual({ storeLabel: '1234', terminalLabel: 'A6008667' });
    expect(Object.keys(d.merchantAccounts)).toEqual(['29', '31']);
  });

  it('decodes a static payload with no point of initiation', () => {
    const d = decodeTanqr(PIX_EXAMPLE);
    expect(d.type).toBe('STATIC');
    expect(d.amount).toBeUndefined();
    expect(d.country).toBe('BR');
  });
});

describe('encode/decode round trip', () => {
  it('round-trips a static QR', () => {
    const payload = encodeTanqr(shop);
    expect(payload.startsWith('000201010211')).toBe(true);
    expect(payload).toContain('5303834');
    expect(payload).toContain('5802TZ');
    const d = decodeTanqr(payload);
    expect(d).toMatchObject({
      type: 'STATIC',
      merchantCode: 'SPM4K9X2Q',
      merchantName: 'Mama Neema Shop',
      merchantCity: 'Dar es Salaam',
      mcc: '5411',
      currency: '834',
      country: 'TZ',
      amount: undefined,
    });
    expect(d.merchantAccounts['26']).toContain(SUREPESA_GUID);
  });

  it('round-trips a dynamic QR with amount and reference', () => {
    const payload = encodeTanqr({
      ...shop,
      type: 'DYNAMIC',
      amount: '12500.50',
      additionalData: { billNumber: 'INV-0042', referenceLabel: '7K2M9QX4TB7K2M9QX4TB', terminalLabel: 'Till 1' },
    });
    expect(payload.startsWith('000201010212')).toBe(true);
    expect(payload).toContain('540812500.50');
    const d = decodeTanqr(payload);
    expect(d.type).toBe('DYNAMIC');
    expect(d.amount).toBe('12500.50');
    expect(d.additionalData).toEqual({ billNumber: 'INV-0042', referenceLabel: '7K2M9QX4TB7K2M9QX4TB', terminalLabel: 'Till 1' });
  });

  it('is deterministic, so a printed static sticker never changes', () => {
    expect(encodeTanqr(shop)).toBe(encodeTanqr({ ...shop }));
  });

  it('truncates long names and drops non-printable characters', () => {
    const d = decodeTanqr(encodeTanqr({ ...shop, merchantName: 'Duka la Vifaa vya Ujenzi na Mabati Ltd', merchantCity: 'Dar es Salaam — Kariakoo' }));
    expect(d.merchantName).toBe('Duka la Vifaa vya Ujenzi');
    expect(d.merchantCity.length).toBeLessThanOrEqual(15);
  });
});

describe('encode validation', () => {
  it('requires an amount for dynamic and forbids one for static', () => {
    expectCode(() => encodeTanqr({ ...shop, type: 'DYNAMIC' }), 'INVALID_VALUE');
    expectCode(() => encodeTanqr({ ...shop, type: 'DYNAMIC', amount: '0' }), 'INVALID_VALUE');
    expectCode(() => encodeTanqr({ ...shop, type: 'DYNAMIC', amount: '1.005' }), 'INVALID_VALUE');
    expectCode(() => encodeTanqr({ ...shop, type: 'DYNAMIC', amount: '-5' }), 'INVALID_VALUE');
    expectCode(() => encodeTanqr({ ...shop, amount: '100' }), 'INVALID_VALUE');
  });

  it('rejects bad merchant codes and MCCs', () => {
    expectCode(() => encodeTanqr({ ...shop, merchantCode: 'spm 1' }), 'INVALID_VALUE');
    expectCode(() => encodeTanqr({ ...shop, mcc: '54' }), 'INVALID_VALUE');
    expectCode(() => encodeTanqr({ ...shop, merchantName: '   ' }), 'INVALID_VALUE');
  });
});

describe('tampered or malformed payloads are rejected', () => {
  const good = encodeTanqr({ ...shop, type: 'DYNAMIC', amount: '5000' });

  it('rejects a changed amount (CRC mismatch)', () => {
    expectCode(() => decodeTanqr(good.replace('54045000', '54049000')), 'CRC_MISMATCH');
  });

  it('rejects a changed merchant code (CRC mismatch)', () => {
    expectCode(() => decodeTanqr(good.replace('SPM4K9X2Q', 'SPM4K9X2R')), 'CRC_MISMATCH');
  });

  it('rejects a corrupted CRC or a missing CRC field', () => {
    expectCode(() => decodeTanqr(good.slice(0, -1) + (good.endsWith('0') ? '1' : '0')), 'CRC_MISMATCH');
    expectCode(() => decodeTanqr(good.slice(0, -8)), 'MISSING_TAG');
    expectCode(() => decodeTanqr(''), 'MISSING_TAG');
  });

  it('rejects malformed TLV even with a valid CRC', () => {
    expectCode(() => decodeTanqr(withCrc('000201010211XX')), 'MALFORMED_TLV');
    expectCode(() => decodeTanqr(withCrc('0002010102115299')), 'MALFORMED_TLV'); // length runs past the end
    expectCode(() => decodeTanqr(withCrc('0100110002010')), 'MALFORMED_TLV'); // 00 not first
  });

  it('rejects duplicate and missing mandatory tags', () => {
    expectCode(() => decodeTanqr(withCrc('00020100020126130009TZ.CO.SP')), 'DUPLICATE_TAG');
    expectCode(() => decodeTanqr(withCrc('000201010211520454115303834')), 'MISSING_TAG'); // no merchant account
    expectCode(() =>
      decodeTanqr(withCrc('000201010211261900140014TZ.CO.SUREPESA5303834')),
    'MALFORMED_TLV'); // broken nested template
  });

  it('rejects an unknown point of initiation', () => {
    const body = encodeTanqr(shop).slice(0, -8).replace('010211', '010213');
    expectCode(() => decodeTanqr(withCrc(body)), 'INVALID_VALUE');
  });
});

describe('parseTlv', () => {
  it('counts lengths in characters, not bytes', () => {
    expect(parseTlv('0004最佳运输0102北京')).toEqual([
      { tag: '00', value: '最佳运输' },
      { tag: '01', value: '北京' },
    ]);
  });
});
