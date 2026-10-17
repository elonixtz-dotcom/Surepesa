import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/payment_models.dart';
import '../../widgets/common.dart';
import 'pay_widgets.dart';

/// The in-app receipt. While the rail is still working (`final` is false, e.g. after a 202),
/// it re-reads the receipt every 5 seconds and shows the server's plain-language status.
class ReceiptScreen extends StatefulWidget {
  const ReceiptScreen({super.key, required this.receipt});

  final Receipt receipt;

  @override
  State<ReceiptScreen> createState() => _ReceiptScreenState();
}

class _ReceiptScreenState extends State<ReceiptScreen> {
  static const _pollEvery = Duration(seconds: 5);

  late Receipt _receipt = widget.receipt;
  Timer? _timer;
  bool _polling = false;

  @override
  void initState() {
    super.initState();
    if (!_receipt.isFinal) _timer = Timer.periodic(_pollEvery, (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    if (_polling) return;
    _polling = true;
    try {
      final app = AppScope.read(context);
      final next = await app.payments.receipt(_receipt.reference);
      if (!mounted) return;
      setState(() => _receipt = next);
      if (next.isFinal) {
        _timer?.cancel();
        app.paymentMade(); // settled: refresh the balance and history
      }
    } catch (_) {
      // Offline for a moment: keep showing the last status and try again on the next tick.
    } finally {
      _polling = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _receipt;
    final (icon, color) = r.succeeded
        ? (Icons.check_circle_rounded, SpColors.positive)
        : !r.isFinal
            ? (Icons.schedule_rounded, SpColors.warning)
            : r.status == 'REVERSED'
                ? (Icons.undo_rounded, SpColors.inkMuted)
                : (Icons.cancel_rounded, SpColors.negative);
    final party = r.counterparty;

    return PayScaffold(
      title: 'Receipt',
      bottom: FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
      children: [
        SpCard(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Icon(icon, color: color, size: 56),
              const SizedBox(height: 10),
              StatusPill(
                label: r.succeeded ? 'Completed' : !r.isFinal ? 'In progress' : r.status == 'REVERSED' ? 'Reversed' : 'Failed',
                tone: r.succeeded
                    ? PillTone.positive
                    : !r.isFinal
                        ? PillTone.warning
                        : r.status == 'REVERSED'
                            ? PillTone.neutral
                            : PillTone.negative,
              ),
              const SizedBox(height: 10),
              Text('${r.isIncoming ? '+' : ''}${r.amount.formatted}', style: moneyStyle(size: 32)),
              const SizedBox(height: 4),
              Text(r.typeLabel, style: const TextStyle(color: SpColors.ink2, fontWeight: FontWeight.w600)),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (!r.isFinal) ...[
                    const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: SpColors.warning),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Flexible(
                    child: Text(
                      r.statusText,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: r.isFinal ? color : SpColors.ink2, fontWeight: FontWeight.w600, height: 1.4),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (!r.isFinal) ...[
          const SizedBox(height: 14),
          const InfoNotice(
            icon: Icons.shield_outlined,
            tone: PillTone.neutral,
            text: 'Your money is held safely and will never be sent twice. If it cannot be completed, it returns to your balance.',
          ),
        ],
        const SizedBox(height: 14),
        SpCard(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
          child: Column(
            children: [
              if (party != null)
                DetailRow(
                  label: r.isIncoming ? 'From' : 'To',
                  value: party.name ?? party.account ?? '—',
                  sub: party.name != null ? party.account : null,
                ),
              DetailRow(label: 'Amount', value: r.amount.formatted),
              if (!r.isIncoming) DetailRow(label: 'Fee', value: r.fee.formatted),
              if (!r.isIncoming) DetailRow(label: 'Total', value: r.total.formatted, bold: true),
              if (r.refunded != null) DetailRow(label: 'Refunded', value: r.refunded!.formatted),
              const Divider(),
              DetailRow(
                label: 'SurePesa ref.',
                value: r.reference,
                mono: true,
                onCopy: () => copyToClipboard(context, r.reference),
              ),
              if (r.rail != null)
                DetailRow(
                  label: '${r.rail!.name} ref.',
                  value: r.rail!.reference ?? (r.isFinal ? 'Not given' : 'Shown once confirmed'),
                  mono: r.rail!.reference != null,
                  onCopy: r.rail!.reference == null ? null : () => copyToClipboard(context, r.rail!.reference!),
                ),
              if (r.relatedTo != null) DetailRow(label: 'Related to', value: r.relatedTo!),
              if (r.description != null && r.description!.isNotEmpty) DetailRow(label: 'Note', value: r.description!),
              DetailRow(label: 'Date', value: formatDateTime(r.completedAt ?? r.createdAt)),
            ],
          ),
        ),
        if (r.rail?.reference != null) ...[
          const SizedBox(height: 12),
          Text(
            'Quote the ${r.rail!.name} reference if you contact ${r.rail!.name} about this payment.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: SpColors.inkMuted, fontSize: 12),
          ),
        ],
        const SizedBox(height: 4),
        TextButton(
          onPressed: () => showComingSoon(context, 'Reporting a problem'),
          child: const Text('Report a problem with this payment'),
        ),
      ],
    );
  }
}
