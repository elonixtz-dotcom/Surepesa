import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../state/payment_models.dart';
import '../widgets/common.dart';
import 'cards/cards_screen.dart';
import 'linked_accounts_screen.dart';
import 'pay/pay_form_screen.dart';

class ServicesScreen extends StatelessWidget {
  const ServicesScreen({super.key});

  static const _services = [
    (Icons.send_to_mobile_rounded, 'Send Money'),
    (Icons.credit_card_rounded, 'Virtual Cards'),
    (Icons.qr_code_2_rounded, 'My QR Code'),
    (Icons.add_card_rounded, 'Add Money'),
    (Icons.account_balance_rounded, 'Withdraw'),
    (Icons.storefront_rounded, 'Pay Merchant'),
    (Icons.phone_android_rounded, 'Mobile Money'),
    (Icons.currency_exchange_rounded, 'Exchange'),
    (Icons.public_rounded, 'Cross-border'),
  ];

  void _open(BuildContext context, String label) {
    final flow = switch (label) {
      'Send Money' => PayFlow.send,
      'Add Money' => PayFlow.deposit,
      'Withdraw' => PayFlow.withdraw,
      'Pay Merchant' => PayFlow.merchant,
      _ => null,
    };
    if (flow != null) {
      openPayFlow(context, flow);
    } else if (label == 'Virtual Cards') {
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const CardsScreen()));
    } else if (label == 'Mobile Money') {
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const LinkedAccountsScreen()));
    } else {
      showComingSoon(context, label);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
        children: [
          Text('Services', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 4,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 0.82,
            children: [
              for (final (icon, label) in _services)
                SpCard(
                  padding: const EdgeInsets.all(8),
                  onTap: () => _open(context, label),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: SpColors.mint, borderRadius: BorderRadius.circular(14)),
                        child: Icon(icon, color: SpColors.tealDark),
                      ),
                      const SizedBox(height: 8),
                      Text(label,
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, height: 1.2)),
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
