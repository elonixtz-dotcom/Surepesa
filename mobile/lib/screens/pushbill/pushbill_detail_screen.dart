import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/payments_api.dart';
import '../../state/app_state.dart';
import '../../state/pushbill_models.dart';
import '../../widgets/common.dart';
import '../pay/pay_widgets.dart';
import '../pay/pin_sheet.dart';

/// Live PushBill session: status, and the actions the signed-in user's role allows.
/// Polls while the session is active so both sides see the call progress.
class PushBillDetailScreen extends StatefulWidget {
  const PushBillDetailScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  State<PushBillDetailScreen> createState() => _PushBillDetailScreenState();
}

class _PushBillDetailScreenState extends State<PushBillDetailScreen> {
  PushBillSession? _session;
  Object? _error;
  bool _busy = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final session = await AppScope.read(context).pushBills.get(widget.sessionId);
      if (!mounted) return;
      setState(() {
        _session = session;
        _error = null;
      });
      _poll?.cancel();
      if (!session.isTerminal) {
        _poll = Timer(const Duration(seconds: 5), _load);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _act(Future<PushBillSession> Function() action) async {
    final app = AppScope.read(context);
    setState(() => _busy = true);
    try {
      final session = await action();
      if (session.state == 'PAID') await app.paymentMade();
      if (mounted) setState(() => _session = session);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
      _load();
    }
  }

  Future<void> _authorize(PushBillSession s) async {
    final app = AppScope.read(context);
    final idempotencyKey = newIdempotencyKey();
    final result = await showPinSheet<PushBillSession>(
      context,
      summary: 'Pay ${s.amountFormatted} to ${s.destinationLabel ?? 'this merchant'}',
      submit: (pin) => app.pushBills.authorize(s.id, pin: pin, idempotencyKey: idempotencyKey),
    );
    if (result != null) {
      await app.paymentMade();
      if (mounted) setState(() => _session = result);
    }
    _load();
  }

  (String, PillTone, IconData) _statusOf(PushBillSession s) => switch (s.state) {
        'PAID' => ('Paid', PillTone.positive, Icons.check_circle_outline_rounded),
        'PAYER_NOTIFIED' => ('Waiting for payer', PillTone.info, Icons.notifications_outlined),
        'CALL_REQUESTED' => ('Call requested', PillTone.info, Icons.phone_outlined),
        'CALLING' => ('Calling both of you…', PillTone.warning, Icons.phone_in_talk_outlined),
        'CALL_CONNECTED' => ('On the call — confirm the details', PillTone.warning, Icons.phone_in_talk_rounded),
        'AWAITING_PAYER_AUTH' => ('Waiting for payer authorisation', PillTone.warning, Icons.lock_outline_rounded),
        'PAYMENT_PROCESSING' || 'PAYMENT_UNKNOWN' => ('Processing payment…', PillTone.warning, Icons.sync_rounded),
        'DECLINED' => ('Declined', PillTone.negative, Icons.block_rounded),
        'NO_ANSWER' => ('No answer', PillTone.negative, Icons.phone_missed_rounded),
        'MISMATCH' => ('Details did not match', PillTone.negative, Icons.error_outline_rounded),
        'EXPIRED' => ('Expired', PillTone.neutral, Icons.schedule_rounded),
        'CANCELLED' => ('Cancelled', PillTone.neutral, Icons.cancel_outlined),
        'PAYMENT_FAILED' => ('Payment failed', PillTone.negative, Icons.error_outline_rounded),
        _ => ('Request created', PillTone.info, Icons.receipt_long_outlined),
      };

  List<Widget> _actions(PushBillSession s) {
    final api = AppScope.read(context).pushBills;
    return [
      if (s.isPayer && s.state == 'PAYER_NOTIFIED') ...[
        BusyButton(label: 'Accept and continue to call', busy: _busy, onPressed: () => _act(() => api.accept(s.id))),
        const SizedBox(height: 10),
        OutlinedButton(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(54)),
          onPressed: _busy ? null : () => _act(() => api.decline(s.id)),
          child: const Text('Decline'),
        ),
      ],
      if (s.state == 'CALL_REQUESTED')
        BusyButton(label: 'Start the phone call', busy: _busy, onPressed: () => _act(() => api.startCall(s.id))),
      if (s.state == 'CALL_CONNECTED') ...[
        BusyButton(
          label: 'Details are correct',
          busy: _busy,
          onPressed: () => _act(() => api.confirm(s.id, result: 'CONFIRMED')),
        ),
        const SizedBox(height: 10),
        OutlinedButton(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(54), foregroundColor: SpColors.negative),
          onPressed: _busy ? null : () => _act(() => api.confirm(s.id, result: 'MISMATCH')),
          child: const Text("Details don't match"),
        ),
      ],
      if (s.isPayer && s.state == 'AWAITING_PAYER_AUTH') ...[
        BusyButton(label: 'Authorise payment', busy: _busy, onPressed: () => _authorize(s)),
        const SizedBox(height: 10),
        OutlinedButton(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(54)),
          onPressed: _busy ? null : () => _act(() => api.decline(s.id)),
          child: const Text('Decline'),
        ),
      ],
      if (!s.isPayer && !s.isTerminal && s.state != 'PAYMENT_PROCESSING' && s.state != 'PAYMENT_UNKNOWN')
        TextButton(onPressed: _busy ? null : () => _act(() => api.cancel(s.id)), child: const Text('Cancel request')),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final s = _session;
    return PayScaffold(
      title: 'PushBill',
      children: [
        if (_error != null)
          InfoNotice(tone: PillTone.negative, text: _error.toString())
        else if (s == null)
          const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
        else ...[
          SpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(s.amountFormatted,
                          style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                    ),
                    StatusPill(label: _statusOf(s).$1, tone: _statusOf(s).$2, icon: _statusOf(s).$3),
                  ],
                ),
                const SizedBox(height: 4),
                Text('To ${s.destinationLabel ?? 'merchant'} · ${s.reference}',
                    style: const TextStyle(color: SpColors.ink2)),
                if (s.note != null) ...[
                  const SizedBox(height: 4),
                  Text('“${s.note}”', style: const TextStyle(color: SpColors.inkMuted)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (s.state == 'CALL_CONNECTED' || s.state == 'CALLING')
            const InfoNotice(
              icon: Icons.shield_outlined,
              text: 'Talk it through on the call, then confirm here. Never say your PIN out loud — SurePesa will never ask for it on a call.',
            )
          else if (s.state == 'AWAITING_PAYER_AUTH' && s.isPayer)
            const InfoNotice(
              text: 'The call is done. Check the merchant and amount, then authorise with your PIN.',
            )
          else if (s.state == 'PAID')
            const InfoNotice(
              tone: PillTone.positive,
              icon: Icons.check_circle_outline_rounded,
              text: 'Paid. The receipt is in your transaction history.',
            ),
          const SizedBox(height: 14),
          ..._actions(s),
        ],
      ],
    );
  }
}
