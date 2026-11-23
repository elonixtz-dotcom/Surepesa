import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'pay/pay_widgets.dart';

/// A biller in the catalogue: icon, name, and what the customer pays for it with.
class _Biller {
  const _Biller(this.icon, this.name, this.hint, this.fieldLabel, {this.group = 'Utilities'});

  final IconData icon;
  final String name;

  /// One line on what this payment is.
  final String hint;

  /// The reference the customer types (meter number, control number...).
  final String fieldLabel;
  final String group;
}

/// Pay Bills: the Tanzanian biller catalogue (LUKU, water, TV, government GePG...).
/// Fulfilment goes live once a biller aggregator (Selcom, AzamPay, Cellulant) is connected —
/// until then each biller is visibly marked as coming soon rather than failing silently.
class BillsScreen extends StatelessWidget {
  const BillsScreen({super.key});

  static const _billers = [
    _Biller(Icons.bolt_rounded, 'LUKU', 'Prepaid electricity — token shown on screen instantly', 'Meter number'),
    _Biller(Icons.water_drop_rounded, 'DAWASCO', 'Dar es Salaam water bill', 'Account number'),
    _Biller(Icons.water_rounded, 'Moruwasa', 'Morogoro water bill', 'Account number'),
    _Biller(Icons.account_balance_rounded, 'TRA', 'Tax payments via control number', 'Control number', group: 'Government'),
    _Biller(Icons.corporate_fare_rounded, 'BRELA', 'Business registrations and licences', 'Control number', group: 'Government'),
    _Biller(Icons.school_rounded, 'GePG', 'Government & university payments', 'Control number', group: 'Government'),
    _Biller(Icons.live_tv_rounded, 'DStv', 'Subscription renewal', 'Smartcard number', group: 'TV & internet'),
    _Biller(Icons.tv_rounded, 'Azam TV', 'Subscription renewal', 'Smartcard number', group: 'TV & internet'),
    _Biller(Icons.satellite_alt_rounded, 'StarTimes', 'Subscription renewal', 'Smartcard number', group: 'TV & internet'),
  ];

  @override
  Widget build(BuildContext context) {
    final groups = <String, List<_Biller>>{};
    for (final b in _billers) {
      groups.putIfAbsent(b.group, () => []).add(b);
    }
    return PayScaffold(
      title: 'Pay Bills',
      children: [
        const InfoNotice(
          icon: Icons.receipt_long_rounded,
          tone: PillTone.neutral,
          text: 'LUKU tokens and payment confirmations will appear on screen instantly and stay in your activity — never only by SMS.',
        ),
        const SizedBox(height: 18),
        for (final MapEntry(key: group, value: billers) in groups.entries) ...[
          SectionHeader(title: group, caps: true),
          const SizedBox(height: 8),
          SpCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < billers.length; i++) ...[
                  if (i > 0) const Divider(height: 1, indent: 64),
                  _BillerTile(biller: billers[i]),
                ],
              ],
            ),
          ),
          const SizedBox(height: 18),
        ],
        const InfoNotice(
          icon: Icons.handshake_outlined,
          tone: PillTone.info,
          text: 'We are connecting a licensed biller aggregator. Each biller switches on automatically the moment it is live — no app update needed.',
        ),
      ],
    );
  }
}

class _BillerTile extends StatelessWidget {
  const _BillerTile({required this.biller});

  final _Biller biller;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: () => showComingSoon(context, biller.name),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      leading: IconChip(icon: biller.icon, color: SpColors.ink2, background: SpColors.line),
      title: Text(biller.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      subtitle: Text(biller.hint, style: const TextStyle(fontSize: 12, color: SpColors.inkMuted)),
      trailing: const StatusPill(label: 'Soon', tone: PillTone.warning),
    );
  }
}
