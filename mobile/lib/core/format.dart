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

/// Accepts 0712345678 or 712345678 (or +255712345678) and returns +255712345678.
String toE164(String input) {
  var digits = input.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('255')) digits = digits.substring(3);
  return '+255${digits.startsWith('0') ? digits.substring(1) : digits}';
}

bool isTzMobile(String e164) => RegExp(r'^\+255[67]\d{8}$').hasMatch(e164);

/// +255690000008 -> "+255 69* *** 008" (as the API masks numbers).
String? maskPhone(String? e164) {
  if (e164 == null) return null;
  final m = RegExp(r'^\+255(\d{2})\d{4}(\d{3})$').firstMatch(e164);
  return m == null ? e164 : '+255 ${m[1]}* *** ${m[2]}';
}

final _dateTime = DateFormat('d MMM y, HH:mm');
final _dayTime = DateFormat('d MMM, HH:mm');

String formatDateTime(DateTime t) => _dateTime.format(t);
String formatShortDateTime(DateTime t) => _dayTime.format(t);

String greetingFor(DateTime now) {
  if (now.hour < 12) return 'Good morning';
  if (now.hour < 17) return 'Good afternoon';
  return 'Good evening';
}

final _dayHeading = DateFormat('EEEE d MMMM');

/// "Today", "Yesterday", or the weekday and date, for grouping activity by day.
String dayHeading(DateTime t, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(t.year, t.month, t.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  return _dayHeading.format(t);
}
