import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/payments_api.dart';
import '../../state/app_state.dart';
import '../../state/payment_models.dart';
import '../../widgets/common.dart';
import 'pay_widgets.dart';
import 'pin_sheet.dart';
import 'receipt_screen.dart';

/// Step 2: the customer sees who gets the money (the registered name, as the rail or SurePesa
/// has it), the fee and the total before entering a PIN.
class ConfirmScreen extends StatefulWidget {
  const ConfirmScreen({super.key, required this.request, required this.quote});

  final PaymentRequest request;
  final Quote quote;

  @override
  State<ConfirmScreen> createState() => _ConfirmScreenState();
}

class _ConfirmScreenState extends State<ConfirmScreen> {
  /// One key per confirmation. Every retry of this attempt (wrong PIN, timeout) reuses it, so
  /// the server returns the original receipt instead of paying twice.
  late final String _idempotencyKey = newIdempotencyKey();
  bool _busy = false;
  String? _error;

  Quote get quote => widget.quote;
  PayFlow get flow => widget.request.flow;

  Future<Receipt> _pay(String? pin) =>
      AppScope.read(context).payments.pay(widget.request, idempotencyKey: _idempotencyKey, pin: pin);

  Future<void> _confirm() async {
    setState(() => _error = null);
    Receipt? receipt;
    if (quote.requiresPin) {
      receipt = await showPinSheet<Receipt>(
        context,
        summary: '${flow.title}: ${quote.total.formatted} to ${quote.recipient.name ?? quote.recipient.account ?? ''}',
        submit: _pay,
      );
    } else {
      setState(() => _busy = true);
      try {
        receipt = await _pay(null);
      } catch (e) {
        if (mounted) setState(() => _error = e.toString());
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    }
    if (!mounted) return;
    if (receipt == null) return;
    final done = receipt;

    final app = AppScope.read(context);
    final navigator = Navigator.of(context);
    app.paymentMade();
    // Replace the form and confirmation with the receipt; back goes home.
    navigator.pushAndRemoveUntil(
      MaterialPageRoute<void>(builder: (_) => ReceiptScreen(receipt: done)),
      (route) => route.isFirst,
    );
  }

  @override
  Widget build(BuildContext context) {
    final recipient = quote.recipient;
    final isDeposit = flow == PayFlow.deposit;
    return PayScaffold(
      title: 'Confirm',
      bottom: BusyButton(
        label: isDeposit ? 'Send request to my phone' : 'Confirm with PIN',
        busy: _busy,
        onPressed: quote.sufficientBalance ? _confirm : null,
      ),
      children: [
        SpCard(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Text(
                switch (flow) {
                  PayFlow.send => 'You are sending to',
                  PayFlow.merchant => 'You are paying',
                  PayFlow.withdraw => 'You are withdrawing to',
                  PayFlow.deposit => 'You are adding money from',
                },
                style: const TextStyle(color: SpColors.inkMuted),
              ),
              const SizedBox(height: 10),
              flow == PayFlow.send
                  ? InitialsAvatar(name: recipient.name, size: 56)
                  : IconChip(
                      icon: flow == PayFlow.merchant ? Icons.storefront_rounded : Icons.account_balance_outlined,
                      color: SpColors.ink2,
                      background: SpColors.line,
                      size: 56,
                    ),
              const SizedBox(height: 10),
              Text(
                recipient.name ?? 'Name not available',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.2),
              ),
              if (recipient.account != null) ...[
                const SizedBox(height: 2),
                Text(recipient.account!, style: const TextStyle(color: SpColors.inkMuted, fontWeight: FontWeight.w600)),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        SpCard(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
          child: Column(
            children: [
              DetailRow(label: 'Amount', value: quote.amount.formatted),
              DetailRow(label: 'Fee', value: quote.fee.formatted),
              const Divider(),
              DetailRow(
                label: isDeposit ? 'You receive' : 'Total',
                value: isDeposit ? quote.amount.formatted : quote.total.formatted,
                bold: true,
              ),
            ],
          ),
        ),
        if (!quote.sufficientBalance) ...[
          const SizedBox(height: 14),
          NoticeBox(
            warning: true,
            text: 'Your balance is not enough for ${quote.total.formatted} including the fee. Add money or enter a smaller amount.',
          ),
        ],
        if (quote.notice != null) ...[
          const SizedBox(height: 14),
          NoticeBox(text: quote.notice!),
        ],
        if (flow == PayFlow.send) ...[
          const SizedBox(height: 14),
          const InfoNotice(text: 'Check the name. Money sent to the wrong person can only be returned if they agree.'),
        ],
        InlineError(_error),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).popUntil((r) => r.isFirst),
          style: TextButton.styleFrom(foregroundColor: SpColors.ink2),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}
