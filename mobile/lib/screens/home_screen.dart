import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import '../state/payment_models.dart';
import '../widgets/balance_card.dart';
import '../widgets/common.dart';
import '../widgets/receipt_tile.dart';
import 'pay/pay_form_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final me = app.me!;
    final text = Theme.of(context).textTheme;

    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: SpColors.teal,
        onRefresh: () async {
          try {
            await app.refresh();
          } catch (e) {
            if (context.mounted) showError(context, e);
          }
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
          children: [
            // Greeting
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${greetingFor(DateTime.now())},',
                          style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                      Text('${me.firstName ?? ''}!',
                          style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800, color: SpColors.teal)),
                      const SizedBox(height: 4),
                      Text('Welcome back to your wallet',
                          style: text.bodySmall?.copyWith(color: SpColors.inkMuted)),
                    ],
                  ),
                ),
                CircleIconButton(
                  icon: Icons.notifications_none_rounded,
                  badge: true,
                  onPressed: () => showComingSoon(context, 'Notifications'),
                ),
              ],
            ),
            const SizedBox(height: 20),
            BalanceCard(
              me: me,
              wallet: me.walletIn('TZS'),
              onTransfer: () => openPayFlow(context, PayFlow.send),
            ),
            const SizedBox(height: 18),
            const _QuickActions(),
            const SizedBox(height: 24),
            SectionHeader(title: 'Quick Transfer', action: 'View All', onAction: () => showComingSoon(context, 'Contacts')),
            const SizedBox(height: 12),
            const _QuickTransferRow(),
            const SizedBox(height: 24),
            if (!me.isVerified) ...[
              _VerifyCard(kycStatus: me.kycStatus),
              const SizedBox(height: 24),
            ],
            const SectionHeader(title: 'Recent Transactions'),
            const SizedBox(height: 12),
            const _RecentTransactions(),
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
      (Icons.south_west_rounded, 'Request', null),
      (Icons.add_rounded, 'Add Money', PayFlow.deposit),
      (Icons.account_balance_outlined, 'Withdraw', PayFlow.withdraw),
    ];
    return Row(
      children: [
        for (final (icon, label, flow) in actions)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: SpCard(
                padding: const EdgeInsets.symmetric(vertical: 14),
                onTap: () => flow == null ? showComingSoon(context, label) : openPayFlow(context, flow),
                child: Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(color: SpColors.mint, borderRadius: BorderRadius.circular(12)),
                      child: Icon(icon, color: SpColors.tealDark, size: 20),
                    ),
                    const SizedBox(height: 8),
                    Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Placeholder until recent recipients are available from the payments API.
class _QuickTransferRow extends StatelessWidget {
  const _QuickTransferRow();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        GestureDetector(
          onTap: () => openPayFlow(context, PayFlow.send),
          child: Column(
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  border: Border.all(color: SpColors.tealLight, width: 1.5),
                ),
                child: const Icon(Icons.add_rounded, color: SpColors.teal),
              ),
              const SizedBox(height: 6),
              const Text('New', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Text(
            'People you pay will appear here for one-tap transfers.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SpColors.inkMuted),
          ),
        ),
      ],
    );
  }
}

class _VerifyCard extends StatelessWidget {
  const _VerifyCard({required this.kycStatus});

  final String kycStatus;

  @override
  Widget build(BuildContext context) {
    final pending = kycStatus == 'PENDING';
    return SpCard(
      padding: const EdgeInsets.all(18),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  pending ? 'Verification in review' : 'Verify your identity\nto start sending',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, height: 1.3),
                ),
                const SizedBox(height: 6),
                Text(
                  pending ? 'We will notify you once approved.' : 'Takes about 2 minutes with your NIDA ID.',
                  style: const TextStyle(color: SpColors.inkMuted, fontSize: 12),
                ),
                if (!pending) ...[
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 16)),
                    onPressed: () => showComingSoon(context, 'Identity verification'),
                    icon: const Text('Verify now'),
                    label: const Icon(Icons.arrow_forward_rounded, size: 18),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 12),
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(gradient: SpColors.cardGradient, borderRadius: BorderRadius.circular(20)),
            child: Icon(pending ? Icons.hourglass_top_rounded : Icons.badge_outlined, color: Colors.white, size: 34),
          ),
        ],
      ),
    );
  }
}

/// The latest few receipts; reloads whenever a payment is made.
class _RecentTransactions extends StatefulWidget {
  const _RecentTransactions();

  @override
  State<_RecentTransactions> createState() => _RecentTransactionsState();
}

class _RecentTransactionsState extends State<_RecentTransactions> {
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
      // Home still works without it; History shows the error.
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    if (items == null || items.isEmpty) return const _EmptyTransactions();
    return SpCard(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const Divider(height: 1, indent: 68),
            ReceiptTile(receipt: items[i]),
          ],
        ],
      ),
    );
  }
}

class _EmptyTransactions extends StatelessWidget {
  const _EmptyTransactions();

  @override
  Widget build(BuildContext context) {
    return const SpCard(
      padding: EdgeInsets.symmetric(vertical: 28, horizontal: 16),
      child: Column(
        children: [
          Icon(Icons.receipt_long_outlined, size: 36, color: SpColors.tealLight),
          SizedBox(height: 10),
          Text('No transactions yet', style: TextStyle(fontWeight: FontWeight.w700)),
          SizedBox(height: 4),
          Text(
            'Add money or receive a payment to get started.',
            textAlign: TextAlign.center,
            style: TextStyle(color: SpColors.inkMuted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
