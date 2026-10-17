import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../screens/pay/receipt_screen.dart';
import '../state/payment_models.dart';

/// One row of transaction history. Tapping it opens the full receipt.
class ReceiptTile extends StatelessWidget {
  const ReceiptTile({super.key, required this.receipt});

  final Receipt receipt;

  @override
  Widget build(BuildContext context) {
    final r = receipt;
    final icon = switch (r.type) {
      'DEPOSIT' => Icons.add_rounded,
      'WITHDRAWAL' => Icons.account_balance_outlined,
      'MERCHANT_PAYMENT' => Icons.storefront_rounded,
      'REFUND' || 'REVERSAL' || 'CARD_REFUND' => Icons.undo_rounded,
      'CARD_PURCHASE' => Icons.shopping_bag_outlined,
      'CARD_LOAD' || 'CARD_UNLOAD' => Icons.credit_card_rounded,
      _ => r.isIncoming ? Icons.south_west_rounded : Icons.north_east_rounded,
    };
    final statusColor = r.succeeded
        ? SpColors.inkMuted
        : !r.isFinal
            ? const Color(0xFFE0A100)
            : SpColors.negative;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ReceiptScreen(receipt: r))),
      leading: CircleAvatar(backgroundColor: SpColors.mint, child: Icon(icon, color: SpColors.tealDark, size: 20)),
      title: Text(
        r.counterparty?.name ?? r.counterparty?.account ?? r.typeLabel,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        r.succeeded ? '${r.typeLabel} · ${formatShortDateTime(r.createdAt)}' : r.statusText,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: statusColor, fontSize: 12),
      ),
      trailing: Text(
        '${r.isIncoming ? '+' : '-'}${r.amount.formatted}',
        style: TextStyle(
          fontWeight: FontWeight.w800,
          color: r.failed ? SpColors.inkMuted : (r.isIncoming ? SpColors.positive : SpColors.ink),
          decoration: r.failed ? TextDecoration.lineThrough : null,
        ),
      ),
    );
  }
}
