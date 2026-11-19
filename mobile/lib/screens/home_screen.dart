import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import '../state/card_models.dart';
import '../state/payment_models.dart';
import '../widgets/balance_card.dart';
import '../widgets/common.dart';
import '../widgets/receipt_tile.dart';
import 'home_shell.dart';
import 'pay/pay_form_screen.dart';
import 'verify_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final me = app.me!;

    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: SpColors.teal,
        onRefresh: () async {
          try {
            await app.paymentMade();
          } catch (e) {
            if (context.mounted) showError(context, e);
          }
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            Row(
              children: [
                InitialsAvatar(name: me.displayName, size: 42, onDark: true),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(greetingFor(DateTime.now()), style: const TextStyle(fontSize: 13, color: SpColors.inkMuted)),
                      Text(me.displayName, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                    ],
                  ),
                ),
                CircleIconButton(
                  icon: Icons.notifications_none_rounded,
                  tooltip: 'Notifications',
                  onPressed: () => showComingSoon(context, 'Notifications'),
                ),
              ],
            ),
            const SizedBox(height: 18),
            BalanceCard(me: me, wallet: me.walletIn('TZS')),
            const SizedBox(height: 18),
            const _QuickActions(),
            const SizedBox(height: 18),
            if (!me.isVerified) ...[
              _VerifyBanner(kycStatus: me.kycStatus),
              const SizedBox(height: 14),
            ],
            const _CardStrip(),
            const _RecentActivity(),
          ],
        ),
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions();

  @override
  Widget build(BuildContext context) {
    const actions = [
      (Icons.north_east_rounded, 'Send', PayFlow.send),
      (Icons.qr_code_2_rounded, 'Pay', PayFlow.merchant),
      (Icons.add_rounded, 'Add money', PayFlow.deposit),
      (Icons.account_balance_outlined, 'Withdraw', PayFlow.withdraw),
    ];
    return Row(
      children: [
        for (final (i, (icon, label, flow)) in actions.indexed)
          Expanded(
            child: Semantics(
              button: true,
              label: label,
              child: InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: () => openPayFlow(context, flow),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    children: [
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          gradient: i == 0 ? SpColors.brandGradient : null,
                          color: i == 0 ? null : SpColors.surface,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Icon(icon, color: i == 0 ? Colors.white : SpColors.ink, size: 22),
                      ),
                      const SizedBox(height: 8),
                      Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _VerifyBanner extends StatelessWidget {
  const _VerifyBanner({required this.kycStatus});

  final String kycStatus;

  @override
  Widget build(BuildContext context) {
    final pending = kycStatus == 'PENDING';
    return SpCard(
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const VerifyScreen())),
      child: Row(
        children: [
          IconChip(
            icon: pending ? Icons.schedule_rounded : Icons.badge_outlined,
            color: pending ? SpColors.warning : SpColors.teal,
            background: pending ? SpColors.warningSoft : SpColors.mint,
            size: 42,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(pending ? 'Verification in review' : 'Verify your identity',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 2),
                Text(
                  pending ? 'We review within one working day.' : 'Needed before you can send money or create cards.',
                  style: const TextStyle(color: SpColors.inkMuted, fontSize: 12),
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded, color: SpColors.inkMuted),
        ],
      ),
    );
  }
}

/// The customer's first open virtual card, if any; opens the Cards tab.
class _CardStrip extends StatefulWidget {
  const _CardStrip();

  @override
  State<_CardStrip> createState() => _CardStripState();
}

class _CardStripState extends State<_CardStrip> {
  VirtualCard? _card;
  int? _version;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final version = AppScope.of(context).activityVersion;
    if (version != _version) {
      _version = version;
      Future.microtask(_load);
    }
  }

  Future<void> _load() async {
    try {
      final (cards, _) = await AppScope.read(context).cards.list();
      final open = cards.where((c) => c.isOpen).toList();
      if (mounted) setState(() => _card = open.isEmpty ? null : open.first);
    } catch (_) {
      // Optional on Home.
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _card;
    if (c == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: SpCard(
        padding: const EdgeInsets.all(14),
        onTap: () => ShellNav.go(context, ShellTab.cards),
        child: Row(
          children: [
            Container(
              width: 54,
              height: 36,
              alignment: Alignment.bottomRight,
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(color: SpColors.ink, borderRadius: BorderRadius.circular(8)),
              child: const Text('VISA', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w900, fontStyle: FontStyle.italic)),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${c.nickname} · ${c.masked}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                  Text(c.isFrozen ? 'Frozen' : 'Card balance ${c.balance.formatted}',
                      style: TextStyle(fontSize: 12, color: c.isFrozen ? SpColors.info : SpColors.inkMuted)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: SpColors.inkMuted),
          ],
        ),
      ),
    );
  }
}

/// The latest few receipts; reloads whenever money moves.
class _RecentActivity extends StatefulWidget {
  const _RecentActivity();

  @override
  State<_RecentActivity> createState() => _RecentActivityState();
}

class _RecentActivityState extends State<_RecentActivity> {
  List<Receipt>? _items;
  int? _version;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final version = AppScope.of(context).activityVersion;
    if (version != _version) {
      _version = version;
      Future.microtask(_load);
    }
  }

  Future<void> _load() async {
    try {
      final page = await AppScope.read(context).payments.history(limit: 4);
      if (mounted) setState(() => _items = page.items);
    } catch (_) {
      // Home still works without it; Activity shows the error.
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return SpCard(
      padding: const EdgeInsets.only(top: 4, bottom: 4),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 6, 0),
            child: SectionHeader(title: 'Recent activity', action: 'See all', onAction: () => ShellNav.go(context, ShellTab.activity)),
          ),
          if (items == null)
            const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
          else if (items.isEmpty)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 20),
              child: Text('No activity yet. Add money or receive a payment to get started.',
                  style: TextStyle(color: SpColors.inkMuted, fontSize: 13)),
            )
          else
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const Divider(indent: 66, endIndent: 16),
              ReceiptTile(receipt: items[i], dense: true),
            ],
        ],
      ),
    );
  }
}
