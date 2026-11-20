import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/escrow_models.dart';
import '../../widgets/common.dart';
import '../pay/pay_widgets.dart';

/// One escrow deal: the state-specific next action for the viewer, the held balance,
/// and the full event history. Release requires the buyer; refund requires the seller
/// or an authorised dispute resolution.
class EscrowDetailScreen extends StatefulWidget {
  const EscrowDetailScreen({super.key, required this.caseId});

  final String caseId;

  @override
  State<EscrowDetailScreen> createState() => _EscrowDetailScreenState();
}

class _EscrowDetailScreenState extends State<EscrowDetailScreen> {
  EscrowDetail? _deal;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final deal = await AppScope.read(context).escrow.get(widget.caseId);
      if (mounted) {
        setState(() {
          _deal = deal;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(Future<EscrowCaseView> Function() action, {String? done}) async {
    setState(() => _busy = true);
    try {
      await action();
      await _load();
      await AppScope.read(context).paymentMade();
      if (done != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _fund() async {
    final pin = await _askPin();
    if (pin == null) return;
    await _run(() => AppScope.read(context).escrow.fund(widget.caseId, pin: pin), done: 'Funds secured in escrow');
  }

  Future<String?> _askPin() async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirm with your PIN'),
        content: TextField(
          controller: controller,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 6,
          decoration: const InputDecoration(labelText: 'PIN', counterText: ''),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Confirm')),
        ],
      ),
    );
  }

  Future<void> _dispute() async {
    final reason = TextEditingController();
    String outcome = 'REFUND_BUYER';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Open a dispute'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: reason,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'What went wrong?'),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: outcome,
                decoration: const InputDecoration(labelText: 'Requested outcome'),
                items: const [
                  DropdownMenuItem(value: 'REFUND_BUYER', child: Text('Refund the buyer')),
                  DropdownMenuItem(value: 'RELEASE_TO_SELLER', child: Text('Pay the seller')),
                ],
                onChanged: (v) => setLocal(() => outcome = v ?? 'REFUND_BUYER'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Open dispute')),
          ],
        ),
      ),
    );
    if (ok != true || reason.text.trim().length < 10) {
      if (ok == true && mounted) showError(context, 'Describe the problem in at least 10 characters');
      return;
    }
    setState(() => _busy = true);
    try {
      await AppScope.read(context).escrow.openDispute(widget.caseId, reason: reason.text.trim(), requestedOutcome: outcome);
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The single most relevant action for the viewer's role and the current state.
  Widget? _primaryAction(EscrowDetail d) {
    final api = AppScope.read(context).escrow;
    if (d.isBuyer) {
      switch (d.status) {
        case 'AWAITING_FUNDING':
          return BusyButton(label: 'Fund ${formatMinorUnits(d.amountMinor, d.currencyCode)}', busy: _busy, onPressed: _fund);
        case 'AWAITING_BUYER_CONFIRMATION':
          return BusyButton(
            label: 'Confirm receipt & release',
            busy: _busy,
            onPressed: () => _run(() => api.confirmReceipt(d.id), done: 'Released to the seller'),
          );
        case 'AWAITING_COUNTERPARTY':
        case 'TERMS_ACCEPTED':
          return BusyButton(
            label: 'Cancel deal',
            busy: _busy,
            onPressed: () => _run(() => api.cancel(d.id), done: 'Deal cancelled'),
          );
      }
    } else {
      switch (d.status) {
        case 'AWAITING_COUNTERPARTY':
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              BusyButton(label: 'Accept terms', busy: _busy, onPressed: () => _run(() => api.acceptTerms(d.id), done: 'Terms accepted')),
              const SizedBox(height: 8),
              OutlinedButton(onPressed: _busy ? null : () => _run(() => api.decline(d.id), done: 'Declined'), child: const Text('Decline')),
            ],
          );
        case 'FUNDED':
          return BusyButton(label: 'Start fulfilment', busy: _busy, onPressed: () => _run(() => api.startFulfilment(d.id)));
        case 'FULFILMENT_IN_PROGRESS':
          return BusyButton(
            label: 'Mark delivered',
            busy: _busy,
            onPressed: () => _run(() => api.markDelivered(d.id), done: 'Marked delivered — buyer inspection window is open'),
          );
      }
    }
    return null;
  }

  Widget? _secondaryAction(EscrowDetail d) {
    final api = AppScope.read(context).escrow;
    final canDispute = const {'FUNDED', 'FULFILMENT_IN_PROGRESS', 'AWAITING_BUYER_CONFIRMATION', 'RELEASE_PENDING'}.contains(d.status);
    final sellerCanRefund = !d.isBuyer && const {'FUNDED', 'FULFILMENT_IN_PROGRESS', 'AWAITING_BUYER_CONFIRMATION'}.contains(d.status);
    if (!canDispute && !sellerCanRefund) return null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (sellerCanRefund)
          OutlinedButton.icon(
            onPressed: _busy ? null : () => _run(() => api.agreeRefund(d.id), done: 'Refunded to the buyer'),
            icon: const Icon(Icons.undo_rounded),
            label: const Text('Refund the buyer'),
          ),
        if (canDispute)
          TextButton.icon(
            onPressed: _busy ? null : _dispute,
            icon: const Icon(Icons.report_problem_outlined),
            label: const Text('Open a dispute'),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _deal;
    return Scaffold(
      appBar: AppBar(title: Text(d?.reference ?? 'Escrow')),
      body: GradientBackground(
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
              children: [
                if (_error != null)
                  InfoNotice(tone: PillTone.negative, text: _error.toString())
                else if (d == null)
                  const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
                else ...[
                  SpCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(d.itemDescription, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                        const SizedBox(height: 8),
                        Text(formatMinorUnits(d.amountMinor, d.currencyCode),
                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 24)),
                        Text(
                          'Fee ${formatMinorUnits(d.feeMinor, d.currencyCode)} · ${d.isBuyer ? 'you are the buyer' : 'you are the seller'} · inspection ${d.inspectionDays} days',
                          style: const TextStyle(color: SpColors.ink2, fontSize: 12.5),
                        ),
                        if (d.heldMinor != null && !d.isTerminal) ...[
                          const SizedBox(height: 8),
                          StatusPill(label: '${formatMinorUnits(d.heldMinor, d.currencyCode)} held in escrow', tone: PillTone.info),
                        ],
                        if (d.status == 'DISPUTED') ...[
                          const SizedBox(height: 8),
                          const InfoNotice(
                            tone: PillTone.negative,
                            text: 'This deal is disputed. No money can move until an authorised resolution.',
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (_primaryAction(d) != null) _primaryAction(d)!,
                  if (_secondaryAction(d) != null) ...[
                    const SizedBox(height: 8),
                    _secondaryAction(d)!,
                  ],
                  const SizedBox(height: 20),
                  const SectionHeader(title: 'History'),
                  for (final e in d.events.reversed)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.circle, size: 8),
                      title: Text(e.action.replaceAll('_', ' '), style: const TextStyle(fontSize: 13)),
                      subtitle: e.note == null ? null : Text(e.note!, style: const TextStyle(fontSize: 11.5)),
                      trailing: Text(formatShortDateTime(e.at), style: const TextStyle(fontSize: 11, color: SpColors.ink2)),
                    ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
