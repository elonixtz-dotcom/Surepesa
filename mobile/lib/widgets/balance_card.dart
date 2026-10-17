import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/models.dart';

/// The hero card: owner, verification badge, balance (hideable) and a Transfer button.
class BalanceCard extends StatefulWidget {
  const BalanceCard({super.key, required this.me, required this.wallet, required this.onTransfer});

  final Me me;
  final WalletSummary? wallet;
  final VoidCallback onTransfer;

  @override
  State<BalanceCard> createState() => _BalanceCardState();
}

class _BalanceCardState extends State<BalanceCard> {
  bool _hidden = false;

  @override
  Widget build(BuildContext context) {
    final wallet = widget.wallet;
    final amount = splitAmount(wallet?.balance ?? '0.00');
    const white = Colors.white;
    final muted = Colors.white.withValues(alpha: 0.85);

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 16, 18),
      decoration: BoxDecoration(
        gradient: SpColors.cardGradient,
        borderRadius: BorderRadius.circular(26),
        boxShadow: [
          BoxShadow(color: SpColors.teal.withValues(alpha: 0.30), blurRadius: 24, offset: const Offset(0, 12)),
        ],
      ),
      child: Stack(
        children: [
          // Decorative wave, echoing the glassy curves in the design.
          Positioned(
            right: -40,
            top: -60,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: 0.10)),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      widget.me.displayName.toUpperCase(),
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: white, fontWeight: FontWeight.w700, letterSpacing: 0.6, fontSize: 13),
                    ),
                  ),
                  const SizedBox(width: 10),
                  _Badge(verified: widget.me.isVerified),
                ],
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Text('Total Balance', style: TextStyle(color: muted, fontSize: 13)),
                  const SizedBox(width: 6),
                  GestureDetector(
                    onTap: () => setState(() => _hidden = !_hidden),
                    child: Icon(_hidden ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 16, color: muted),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: FittedBox(
                      alignment: Alignment.centerLeft,
                      fit: BoxFit.scaleDown,
                      child: Text.rich(
                        _hidden
                            ? const TextSpan(text: 'TZS ••••••')
                            : TextSpan(children: [
                                TextSpan(text: '${wallet?.currency ?? 'TZS'} ', style: const TextStyle(fontSize: 20)),
                                TextSpan(text: amount.whole),
                                TextSpan(text: amount.fraction, style: const TextStyle(fontSize: 18)),
                              ]),
                        style: const TextStyle(color: white, fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: -0.5),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  _TransferButton(onTap: widget.onTransfer),
                ],
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.account_balance_wallet_outlined, color: white, size: 16),
                    const SizedBox(width: 6),
                    Text(
                      'Wallet •••• ${wallet == null ? '----' : wallet.id.substring(wallet.id.length - 4).toUpperCase()}',
                      style: const TextStyle(color: white, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.verified});

  final bool verified;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.22),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(verified ? Icons.verified_rounded : Icons.shield_outlined, size: 13, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            verified ? 'Verified' : 'Unverified',
            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _TransferButton extends StatelessWidget {
  const _TransferButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.22),
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: Colors.white.withValues(alpha: 0.5)),
        ),
        child: const Column(
          children: [
            CircleAvatar(
              radius: 20,
              backgroundColor: SpColors.tealDark,
              child: Icon(Icons.north_east_rounded, color: Colors.white),
            ),
            SizedBox(height: 4),
            Text('Transfer', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
