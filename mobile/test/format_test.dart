import 'package:flutter_test/flutter_test.dart';
import 'package:surepesa/core/format.dart';

void main() {
  test('formats API decimal strings without floating point', () {
    expect(formatMoney('245000.00', 'TZS'), 'TZS 245,000.00');
    expect(formatMoney('0.50', 'TZS'), 'TZS 0.50');
    expect(formatMoney('-1500.25', 'USD'), 'USD -1,500.25');
  });

  test('greets by time of day', () {
    expect(greetingFor(DateTime(2026, 1, 1, 8)), 'Good morning');
    expect(greetingFor(DateTime(2026, 1, 1, 13)), 'Good afternoon');
    expect(greetingFor(DateTime(2026, 1, 1, 20)), 'Good evening');
  });

  test('groups activity by day', () {
    final now = DateTime(2026, 10, 17, 9);
    expect(dayHeading(DateTime(2026, 10, 17, 0, 5), now: now), 'Today');
    expect(dayHeading(DateTime(2026, 10, 16, 23, 59), now: now), 'Yesterday');
    expect(dayHeading(DateTime(2026, 10, 14, 12), now: now), 'Wednesday 14 October');
  });

  test('masks phone numbers', () {
    expect(maskPhone('+255712345678'), isNot(contains('2345')));
    expect(maskPhone(null), isNull);
  });
}
