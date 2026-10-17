import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../services/payments_api.dart';
import '../../state/app_state.dart';
import '../../state/card_models.dart';
import '../../widgets/receipt_tile.dart';
import '../../widgets/virtual_card_face.dart';
import '../pay/pay_widgets.dart';
import '../pay/pin_sheet.dart';

/// One card: balance, details behind the PIN, load/unload, freeze, limit, close, activity.
class CardDetailScreen extends StatefulWidget {
  const CardDetailScreen({super.key, required this.cardId});

  final String cardId;

  @override
  State<CardDetailScreen> createState() => _CardDetailScreenState();
}

class _CardDetailScreenState extends State<CardDetailScreen> with WidgetsBindingObserver {
  static const _showFor = Duration(seconds: 60);

  CardPage? _page;
  String? _error;
  bool _busy = false;

  // Revealed details live only in memory, only on this screen, only briefly.
  RevealedNumbers? _details;
  Timer? _hideTimer;
  int _secondsLeft = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hideTimer?.cancel();
    super.dispose();
  }

  /// Leaving the app hides the card number at once (app switcher snapshots, shoulder surfing).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _hide();
  }

  Future<void> _load() async {
    try {
      final page = await AppScope.read(context).cards.get(widget.cardId);
      if (mounted) {
        setState(() {
          _page = page;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _hide() {
    _hideTimer?.cancel();
    if (_details != null && mounted) setState(() => _details = null);
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _reveal() async {
    final card = _page!.card;
    final details = await showPinSheet<CardDetails>(
      context,
      summary: 'Show the details of ${card.nickname}',
      submit: (pin) => AppScope.read(context).cards.reveal(card.id, pin),
    );
    if (details == null || !mounted) return;
    switch (details) {
      case DeliveredByIssuer(:final message):
        _toast(message);
      case RevealedNumbers():
        setState(() {
          _details = details;
          _secondsLeft = _showFor.inSeconds;
        });
        _hideTimer?.cancel();
        _hideTimer = Timer.periodic(const Duration(seconds: 1), (t) {
          if (!mounted) return t.cancel();
          if (_secondsLeft <= 1) return _hide();
          setState(() => _secondsLeft--);
        });
    }
  }

  Future<void> _copy(String label, String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (mounted) _toast('$label copied');
  }

  /// Load (wallet -> card) or unload (card -> wallet).
  Future<void> _move({required bool toCard}) async {
    final card = _page!.card;
    final amount = await _askAmount(toCard ? 'Add money to ${card.nickname}' : 'Move back to your wallet');
    if (amount == null || !mounted) return;
    final app = AppScope.read(context);
    final key = newIdempotencyKey();
    final receipt = await showPinSheet(
      context,
      summary: toCard ? 'Load TZS $amount onto ${card.nickname}' : 'Move TZS $amount to your wallet',
      submit: (pin) => toCard
          ? app.cards.load(card.id, amount: amount, pin: pin, idempotencyKey: key)
          : app.cards.unload(card.id, amount: amount, pin: pin, idempotencyKey: key),
    );
    if (receipt == null || !mounted) return;
    app.paymentMade();
    _toast(receipt.statusText);
    _load();
  }

  Future<void> _toggleFreeze() async {
    final card = _page!.card;
    final app = AppScope.read(context);
    if (card.isActive) {
      setState(() => _busy = true);
      try {
        await app.cards.freeze(card.id);
        _hide();
        _toast('Card frozen. Purchases will be declined until you unfreeze it.');
      } on ApiException catch (e) {
        _toast(e.message);
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    } else {
      final done = await showPinSheet(context, summary: 'Unfreeze ${card.nickname}', submit: (pin) => app.cards.unfreeze(card.id, pin));
      if (done != null) _toast('Card is active again');
    }
    _load();
  }

  Future<void> _editLimit() async {
    final card = _page!.card;
    final value = await _askAmount('Limit per purchase', allowClear: card.perTransactionLimit != null);
    if (value == null || !mounted) return;
    try {
      await AppScope.read(context).cards.setLimit(card.id, value.isEmpty ? null : value);
      _toast(value.isEmpty ? 'Limit removed' : 'Purchases above TZS $value will be declined');
    } on ApiException catch (e) {
      _toast(e.message);
    }
    _load();
  }

  Future<void> _close() async {
    final card = _page!.card;
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Close this card?'),
        content: Text('${card.nickname} stops working for good. ${card.balance.formatted} goes back to your SurePesa wallet. Subscriptions using this card will fail.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep card')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: SpColors.negative),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Close card'),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    final app = AppScope.read(context);
    final closed = await showPinSheet(context, summary: 'Close ${card.nickname}', submit: (pin) => app.cards.close(card.id, pin));
    if (closed == null || !mounted) return;
    app.paymentMade();
    Navigator.of(context).pop();
  }

  Future<void> _testPurchase() async {
    final amount = await _askAmount('Test purchase (simulated issuer)');
    if (amount == null || amount.isEmpty || !mounted) return;
    try {
      final r = await AppScope.read(context).cards.testPurchase(_page!.card.id, amount: amount, merchantName: 'Netflix');
      _toast(r['decision'] == 'APPROVED' ? 'Approved: Netflix TZS $amount' : 'Declined: ${r['reason']}');
    } on ApiException catch (e) {
      _toast(e.message);
    }
    _load();
  }

  Future<String?> _askAmount(String title, {bool allowClear = false}) {
    final ctrl = TextEditingController();
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 20, 24, 24 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            TextField(
              controller: ctrl,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9)],
              decoration: const InputDecoration(prefixText: 'TZS ', labelText: 'Amount'),
              onSubmitted: (v) => Navigator.pop(ctx, v),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('Continue')),
            if (allowClear) TextButton(onPressed: () => Navigator.pop(ctx, ''), child: const Text('Remove limit')),
          ],
        ),
      ),
    ).then((v) => v == null || (v.isEmpty && !allowClear) ? null : v);
  }

  @override
  Widget build(BuildContext context) {
    final page = _page;
    if (page == null) {
      return PayScaffold(title: 'Card', children: [
        if (_error != null) NoticeBox(text: _error!, warning: true) else const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
      ]);
    }
    final card = page.card;
    final d = _details;
    return PayScaffold(
      title: card.nickname,
      children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          switchInCurve: Curves.easeOutCubic,
          child: VirtualCardFace(key: ValueKey(d != null), card: card, details: d),
        ),
        const SizedBox(height: 10),
        if (d != null)
          Row(children: [
            TextButton.icon(onPressed: () => _copy('Card number', d.pan), icon: const Icon(Icons.copy_rounded, size: 18), label: const Text('Number')),
            TextButton.icon(onPressed: () => _copy('CVV', d.cvv), icon: const Icon(Icons.copy_rounded, size: 18), label: const Text('CVV')),
            const Spacer(),
            Text('Hides in ${_secondsLeft}s', style: const TextStyle(color: SpColors.inkMuted, fontSize: 12)),
            IconButton(onPressed: _hide, tooltip: 'Hide now', icon: const Icon(Icons.visibility_off_rounded)),
          ])
        else if (card.isOpen)
          OutlinedButton.icon(onPressed: _reveal, icon: const Icon(Icons.visibility_rounded), label: const Text('Show card details')),
        const SizedBox(height: 18),
        Row(children: [
          const Text('Card balance', style: TextStyle(color: SpColors.inkMuted)),
          const Spacer(),
          Text(card.balance.formatted, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20, color: SpColors.ink)),
        ]),
        if (card.status == 'REQUESTED') const Padding(padding: EdgeInsets.only(top: 12), child: NoticeBox(text: 'Your card is being issued. This usually takes under a minute.')),
        if (card.isClosed) const Padding(padding: EdgeInsets.only(top: 12), child: NoticeBox(text: 'This card is closed. Its balance was returned to your wallet.')),
        if (card.isOpen) ...[
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: FilledButton.icon(onPressed: card.isClosed ? null : () => _move(toCard: true), icon: const Icon(Icons.add_rounded), label: const Text('Add money'))),
            const SizedBox(width: 10),
            Expanded(child: OutlinedButton.icon(onPressed: () => _move(toCard: false), icon: const Icon(Icons.south_west_rounded), label: const Text('To wallet'))),
          ]),
          const SizedBox(height: 16),
          _SettingTile(
            icon: card.isFrozen ? Icons.lock_open_rounded : Icons.ac_unit_rounded,
            title: card.isFrozen ? 'Unfreeze card' : 'Freeze card',
            subtitle: card.isFrozen ? 'Purchases are being declined' : 'Pause all purchases instantly',
            onTap: _busy ? null : _toggleFreeze,
          ),
          _SettingTile(
            icon: Icons.speed_rounded,
            title: 'Limit per purchase',
            subtitle: card.perTransactionLimit?.formatted ?? 'No limit (up to the card balance)',
            onTap: _editLimit,
          ),
          if (kDebugMode)
            _SettingTile(icon: Icons.science_outlined, title: 'Test purchase', subtitle: 'Development only: simulated Netflix charge', onTap: _testPurchase),
          _SettingTile(icon: Icons.delete_outline_rounded, title: 'Close card', subtitle: 'Balance returns to your wallet', danger: true, onTap: _close),
        ],
        const SizedBox(height: 18),
        Text('Activity', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        if (page.transactions.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('No activity yet. Load the card to start using it.', style: TextStyle(color: SpColors.inkMuted)))
        else
          for (final r in page.transactions) ReceiptTile(receipt: r),
      ],
    );
  }
}

class _SettingTile extends StatelessWidget {
  const _SettingTile({required this.icon, required this.title, required this.subtitle, this.onTap, this.danger = false});

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger ? SpColors.negative : SpColors.tealDark;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
        child: Icon(icon, color: color),
      ),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: danger ? SpColors.negative : SpColors.ink)),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}
