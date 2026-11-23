import 'package:intl/intl.dart';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../state/payment_models.dart';
import 'common.dart';

/// "This month": money in vs money out across the loaded activity, plus where the money
/// went (top payment types). Sums per currency; the wallet's main currency is shown.
class ActivityInsights extends StatelessWidget {
  const ActivityInsights({super.key, required this.items});

  final List<Receipt> items;

  static final _fmt = NumberFormat('#,##0');

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final month = items.where((r) => r.succeeded && r.createdAt.year == now.year && r.createdAt.month == now.month);
    if (month.isEmpty) return const SizedBox.shrink();

    // Sum per currency; show the currency with the most activity.
    final byCurrency = <String, List<Receipt>>{};
    for (final r in month) {
      byCurrency.putIfAbsent(r.currency, () => []).add(r);
    }
    final currency = byCurrency.entries.reduce((a, b) => a.value.length >= b.value.length ? a : b).key;
    final rows = byCurrency[currency]!;

    var inSum = 0.0, outSum = 0.0;
    final outByType = <String, double>{};
    for (final r in rows) {
      final v = double.tryParse(r.amount.value) ?? 0;
      if (r.isIncoming) {
        inSum += v;
      } else {
        outSum += v;
        outByType.update(r.typeLabel, (s) => s + v, ifAbsent: () => v);
      }
    }
    final topTypes = outByType.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final shown = topByTypeCap(topTypes);

    return SpCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('This month', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: SpColors.ink)),
              ),
              Text(currency, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: SpColors.inkMuted)),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: _total('Money in', inSum, SpColors.positive, Icons.south_west_rounded)),
              const SizedBox(width: 12),
              Expanded(child: _total('Money out', outSum, SpColors.ink, Icons.north_east_rounded)),
            ],
          ),
          if (shown.isNotEmpty) ...[
            const SizedBox(height: 16),
            const Divider(height: 1),
            const SizedBox(height: 12),
            for (final e in shown) ...[
              _TypeBar(label: e.key, amount: e.value, fraction: outSum == 0 ? 0 : e.value / topTypes.first.value, fmt: _fmt),
              const SizedBox(height: 10),
            ],
          ],
        ],
      ),
    );
  }

  static List<MapEntry<String, double>> topByTypeCap(List<MapEntry<String, double>> sorted) =>
      sorted.length <= 4 ? sorted : sorted.sublist(0, 4);

  Widget _total(String label, double sum, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: SpColors.ground, borderRadius: BorderRadius.circular(SpRadii.control)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 5),
            Text(label, style: const TextStyle(fontSize: 12, color: SpColors.inkMuted, fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 6),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(_fmt.format(sum.round()), style: moneyStyle(size: 20, color: color)),
          ),
        ],
      ),
    );
  }
}

class _TypeBar extends StatelessWidget {
  const _TypeBar({required this.label, required this.amount, required this.fraction, required this.fmt});

  final String label;
  final double amount;
  final double fraction;
  final NumberFormat fmt;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: SpColors.ink2))),
            Text(fmt.format(amount.round()),
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()])),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: fraction.clamp(0.0, 1.0),
            minHeight: 6,
            backgroundColor: SpColors.line,
            valueColor: const AlwaysStoppedAnimation(SpColors.teal),
          ),
        ),
      ],
    );
  }
}
