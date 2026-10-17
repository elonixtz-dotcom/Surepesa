import 'package:intl/intl.dart';

final _grouped = NumberFormat('#,##0', 'en_US');

/// Splits an API decimal string ("245000.50") into display parts ("245,000", ".50").
/// Amounts stay strings end to end, so no floating-point rounding is introduced.
({String whole, String fraction}) splitAmount(String decimal) {
  final negative = decimal.startsWith('-');
  final unsigned = negative ? decimal.substring(1) : decimal;
  final parts = unsigned.split('.');
  final whole = _grouped.format(BigInt.parse(parts[0]).toInt());
  final fraction = parts.length > 1 ? '.${parts[1]}' : '';
  return (whole: '${negative ? '-' : ''}$whole', fraction: fraction);
}

String formatMoney(String decimal, String currency) {
  final p = splitAmount(decimal);
  return '$currency ${p.whole}${p.fraction}';
}

String greetingFor(DateTime now) {
  if (now.hour < 12) return 'Good Morning';
  if (now.hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}
