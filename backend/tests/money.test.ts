import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { basisPoints, formatMoney, fromMinorUnits, toMinorUnits } from '../src/lib/money';
import { assertBalancedLines } from '../src/services/ledger.service';
import { calculateFee } from '../src/services/fee.service';
import { convertMinor } from '../src/services/fx.service';

describe('money', () => {
  it('parses decimal strings into minor units', () => {
    expect(toMinorUnits('1500', 2)).toBe(150000n);
    expect(toMinorUnits('1500.5', 2)).toBe(150050n);
    expect(toMinorUnits('0.01', 2)).toBe(1n);
  });

  it('rejects invalid or over-precise amounts', () => {
    for (const bad of ['-1', '1e5', 'abc', '', '1.001', '1,000']) {
      expect(() => toMinorUnits(bad, 2)).toThrow(RangeError);
    }
  });

  it('formats minor units', () => {
    expect(fromMinorUnits(150050n, 2)).toBe('1500.50');
    expect(fromMinorUnits(5n, 2)).toBe('0.05');
    expect(fromMinorUnits(-5n, 2)).toBe('-0.05');
    expect(formatMoney(24500000n, 'TZS', 2)).toBe('TZS 245,000.00');
  });

  it('rounds basis points half-up', () => {
    expect(basisPoints(10_000n, 50)).toBe(50n);
    expect(basisPoints(101n, 50)).toBe(1n); // 0.505 -> 1
    expect(basisPoints(99n, 50)).toBe(0n); // 0.495 -> 0
  });
});

describe('ledger posting validation', () => {
  const currency = (id: string) => (id.startsWith('usd') ? 'USD' : 'TZS');

  it('accepts a balanced posting', () => {
    expect(() =>
      assertBalancedLines(
        [
          { walletId: 'a', amount: -100n, entryType: 'PRINCIPAL' },
          { walletId: 'b', amount: 100n, entryType: 'PRINCIPAL' },
        ],
        currency,
      ),
    ).not.toThrow();
  });

  it('rejects unbalanced, zero and single-line postings', () => {
    expect(() =>
      assertBalancedLines(
        [
          { walletId: 'a', amount: -100n, entryType: 'PRINCIPAL' },
          { walletId: 'b', amount: 99n, entryType: 'PRINCIPAL' },
        ],
        currency,
      ),
    ).toThrow(/unbalanced/);
    expect(() =>
      assertBalancedLines(
        [
          { walletId: 'a', amount: 0n, entryType: 'PRINCIPAL' },
          { walletId: 'b', amount: 0n, entryType: 'PRINCIPAL' },
        ],
        currency,
      ),
    ).toThrow(/zero/);
    expect(() => assertBalancedLines([{ walletId: 'a', amount: 1n, entryType: 'PRINCIPAL' }], currency)).toThrow();
  });

  it('requires each currency to balance on its own', () => {
    expect(() =>
      assertBalancedLines(
        [
          { walletId: 'a', amount: -250000n, entryType: 'FX' },
          { walletId: 'usd-b', amount: 100n, entryType: 'FX' },
        ],
        currency,
      ),
    ).toThrow(/unbalanced/);
  });
});

describe('fees', () => {
  it('applies min/max to withdrawal fees', () => {
    expect(calculateFee('WITHDRAWAL', 1_000_00n)).toBe(500_00n); // TZS 1,000 -> min TZS 500
    expect(calculateFee('WITHDRAWAL', 400_000_00n)).toBe(2_000_00n); // 0.5%
    expect(calculateFee('WITHDRAWAL', 10_000_000_00n)).toBe(5_000_00n); // capped
    expect(calculateFee('P2P_TRANSFER', 25_000_00n)).toBe(0n);
  });
});

describe('fx conversion', () => {
  it('converts using a decimal rate and rounds down', () => {
    expect(convertMinor(100_00n, new Prisma.Decimal('2500'), 2, 2)).toBe(250_000_00n); // $100 -> TZS 250,000
    expect(convertMinor(1n, new Prisma.Decimal('0.0004'), 2, 2)).toBe(0n);
    expect(convertMinor(250_000_00n, new Prisma.Decimal('0.0004'), 2, 2)).toBe(100_00n);
  });
});
