import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/models.dart';

/// The money surface on Home: available balance on ink, hideable, with the wallet and its
/// verification state underneath.
class BalanceCard extends StatefulWidget {
  const BalanceCard({super.key, required this.me, required this.wallet});

  final Me me;
  final WalletSummary? wallet;

  @override
  State<BalanceCard> createState() => _BalanceCardState();
}

class _BalanceCardState extends State<BalanceCard> {
  bool _hidden = false;

  @override
  Widget build(BuildContext context) {
    final wallet = widget.wallet;
    final amount = splitAmount(wallet?.balance ?? '0.00');
    final phone = maskPhone(widget.me.phoneNumber);

    return Semantics(
      container: true,
      label: _hidden ? 'Balance hidden' : 'Available balance ${wallet?.currency ?? 'TZS'} ${amount.whole}${amount.fraction}',
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: SpColors.brandGradient,
          borderRadius: BorderRadius.circular(SpRadii.hero),
          boxShadow: const [BoxShadow(color: Color(0x33E03A1E), blurRadius: 24, offset: Offset(0, 10))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(child: Text('Available balance', style: TextStyle(color: SpColors.inkMutedOnDark, fontSize: 13))),
                Material(
                  color: SpColors.inkSurface,
                  borderRadius: BorderRadius.circular(10),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => setState(() => _hidden = !_hidden),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      child: Text(_hidden ? 'Show' : 'Hide',
                          style: const TextStyle(color: SpColors.inkMutedOnDark, fontSize: 12, fontWeight: FontWeight.w700)),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            FittedBox(
              alignment: Alignment.centerLeft,
              fit: BoxFit.scaleDown,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(wallet?.currency ?? 'TZS', style: const TextStyle(color: SpColors.tealLight, fontSize: 15, fontWeight: FontWeight.w700)),
                  const SizedBox(width: 8),
                  Text(
                    _hidden ? '••••••' : '${amount.whole}${amount.fraction}',
                    style: moneyStyle(size: 34, color: Colors.white),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Text(phone == null ? 'SurePesa wallet' : 'Wallet $phone',
                      style: const TextStyle(color: SpColors.inkMutedOnDark, fontSize: 12)),
                ),
                Icon(widget.me.isVerified ? Icons.check_rounded : Icons.shield_outlined,
                    size: 15, color: Colors.white),
                const SizedBox(width: 4),
                Text(
                  widget.me.isVerified ? 'Verified' : 'Not verified',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
