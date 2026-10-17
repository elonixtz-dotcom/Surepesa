import 'package:flutter_test/flutter_test.dart';
import 'package:surepesa/core/format.dart';

void main() {
  test('formats API decimal strings without floating point', () {
    expect(formatMoney('245000.00', 'TZS'), 'TZS 245,000.00');
    expect(formatMoney('0.50', 'TZS'), 'TZS 0.50');
    expect(formatMoney('-1500.25', 'USD'), 'USD -1,500.25');
  });

  test('greets by time of day', () {
    expect(greetingFor(DateTime(2026, 1, 1, 8)), 'Good Morning');
    expect(greetingFor(DateTime(2026, 1, 1, 13)), 'Good Afternoon');
    expect(greetingFor(DateTime(2026, 1, 1, 20)), 'Good Evening');
  });
}
