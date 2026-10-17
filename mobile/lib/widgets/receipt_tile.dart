import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../screens/pay/receipt_screen.dart';
import '../state/payment_models.dart';
import 'common.dart';

/// One row of activity: who, what and when, the amount, and the status in words when it is
/// not simply completed. Tapping opens the full receipt.
class ReceiptTile extends StatelessWidget {
  const ReceiptTile({super.key, required this.receipt, this.dense = false});

  final Receipt receipt;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final r = receipt;
    final person = r.type == 'P2P_TRANSFER' || r.type == 'MERCHANT_PAYMENT';
    final icon = switch (r.type) {
      'DEPOSIT' => Icons.south_rounded,
      'WITHDRAWAL' => Icons.account_balance_outlined,
      'REFUND' || 'REVERSAL' || 'CARD_REFUND' => Icons.undo_rounded,
      'CARD_PURCHASE' => Icons.shopping_bag_outlined,
      'CARD_LOAD' || 'CARD_UNLOAD' => Icons.credit_card_rounded,
      _ => r.isIncoming ? Icons.south_west_rounded : Icons.north_east_rounded,
    };
    final pending = !r.isFinal;
    final (subtitle, subColor) = r.failed
        ? (r.statusText, SpColors.negative)
        : pending
            ? ('In progress · ${formatShortDateTime(r.createdAt)}', SpColors.warning)
            : ('${r.typeLabel} · ${formatShortDateTime(r.createdAt)}', SpColors.inkMuted);

    final Widget leading = pending
        ? const IconChip(icon: Icons.schedule_rounded, color: SpColors.warning, background: SpColors.warningSoft)
        : r.failed
            ? const IconChip(icon: Icons.close_rounded, color: SpColors.negative, background: SpColors.negativeSoft)
            : person
                ? InitialsAvatar(name: r.counterparty?.name, size: 38)
                : IconChip(icon: icon, color: SpColors.ink2, background: SpColors.line);

    final sign = r.isIncoming ? '+' : '−';
    return InkWell(
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ReceiptScreen(receipt: r))),
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: dense ? 10 : 12),
        child: Row(
          children: [
            leading,
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    r.counterparty?.name ?? r.counterparty?.account ?? r.typeLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                  ),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: subColor, fontSize: 12, fontWeight: subColor == SpColors.inkMuted ? FontWeight.w500 : FontWeight.w600)),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Text(
              r.failed ? r.amount.formatted.replaceFirst('TZS ', '') : '$sign${r.amount.formatted.replaceFirst('TZS ', '')}',
              style: moneyStyle(size: 14, color: r.failed ? SpColors.inkMuted : (r.isIncoming ? SpColors.positive : SpColors.ink)).copyWith(
                decoration: r.failed ? TextDecoration.lineThrough : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
