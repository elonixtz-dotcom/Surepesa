import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/payment_models.dart';
import '../../widgets/common.dart';
import '../linked_accounts_screen.dart';
import 'confirm_screen.dart';
import 'pay_widgets.dart';

void openPayFlow(BuildContext context, PayFlow flow) {
  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PayFormScreen(flow: flow)));
}

/// Step 1 of every payment: who (phone, merchant code or linked account) and how much.
/// Continue asks the server for a quote and opens the confirmation screen.
class PayFormScreen extends StatefulWidget {
  const PayFormScreen({super.key, required this.flow});

  final PayFlow flow;

  @override
  State<PayFormScreen> createState() => _PayFormScreenState();
}

class _PayFormScreenState extends State<PayFormScreen> {
  final _form = GlobalKey<FormState>();
  final _target = TextEditingController();
  final _amount = TextEditingController();
  bool _busy = false;
  String? _error;

  List<PaymentMethod>? _methods;
  String? _methodId;
  bool _loadingMethods = false;

  PayFlow get flow => widget.flow;

  @override
  void initState() {
    super.initState();
    if (flow.usesLinkedAccount) _loadMethods();
  }

  @override
  void dispose() {
    _target.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _loadMethods() async {
    _loadingMethods = true; // no setState: this also runs from initState
    try {
      final methods = await AppScope.read(context).payments.paymentMethods();
      if (!mounted) return;
      setState(() {
        _methods = methods.where((m) => m.status != 'DISABLED').toList();
        if (_methods!.every((m) => m.id != _methodId)) {
          _methodId = _methods!.isEmpty
              ? null
              : _methods!.firstWhere((m) => m.isDefault, orElse: () => _methods!.first).id;
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loadingMethods = false);
    }
  }

  Future<void> _linkAccount() async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const LinkedAccountsScreen()));
    if (mounted) await _loadMethods();
  }

  PaymentRequest _request() {
    final amount = _amount.text.trim();
    return switch (flow) {
      PayFlow.send => PaymentRequest(flow: flow, amount: amount, recipientPhone: toE164(_target.text)),
      PayFlow.merchant => PaymentRequest(flow: flow, amount: amount, merchantCode: _target.text.trim().toUpperCase()),
      PayFlow.withdraw || PayFlow.deposit => PaymentRequest(flow: flow, amount: amount, paymentMethodId: _methodId),
    };
  }

  Future<void> _continue() async {
    setState(() => _error = null);
    if (!_form.currentState!.validate()) return;
    if (flow.usesLinkedAccount && _methodId == null) {
      setState(() => _error = 'Link a mobile money account first');
      return;
    }
    final request = _request();
    setState(() => _busy = true);
    try {
      final quote = await AppScope.read(context).payments.quote(request);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => ConfirmScreen(request: request, quote: quote)),
      );
    } catch (e) {
      // RECIPIENT_NOT_FOUND, MERCHANT_NOT_FOUND, SELF_TRANSFER, ACCOUNT_INVALID...: the server's words.
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wallet = AppScope.of(context).me?.walletIn('TZS');
    return PayScaffold(
      title: flow.title,
      bottom: BusyButton(label: flow == PayFlow.deposit ? 'Continue' : 'Review payment', busy: _busy, onPressed: _continue),
      children: [
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (wallet != null && flow != PayFlow.deposit)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    'Available balance  ${formatMoney(wallet.balance, wallet.currency)}',
                    style: const TextStyle(color: SpColors.ink2, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ),
              ..._targetFields(),
              const SizedBox(height: 14),
              _label('Amount (TZS)'),
              TextFormField(
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [
                  // Whole shillings or up to 2 decimals; amounts go to the API as typed.
                  TextInputFormatter.withFunction(
                    (old, next) => RegExp(r'^\d{0,15}(\.\d{0,2})?$').hasMatch(next.text) ? next : old,
                  ),
                ],
                style: moneyStyle(size: 28),
                decoration: const InputDecoration(hintText: '0', prefixText: 'TZS  '),
                validator: (v) {
                  final value = num.tryParse(v?.trim() ?? '');
                  return value == null || value <= 0 ? 'Enter an amount greater than zero' : null;
                },
              ),
              const SizedBox(height: 10),
              Wrap(spacing: 8, children: [
                for (final q in const ['5000', '10000', '50000'])
                  ActionChip(
                    label: Text(splitAmount(q).whole),
                    onPressed: () => setState(() => _amount.text = q),
                  ),
              ]),
              InlineError(_error),
            ],
          ),
        ),
      ],
    );
  }

  List<Widget> _targetFields() {
    switch (flow) {
      case PayFlow.send:
        return [
          _label('Recipient phone number'),
          TextFormField(
            controller: _target,
            autofocus: true,
            keyboardType: TextInputType.phone,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(12)],
            decoration: const InputDecoration(
              hintText: '712 345 678',
              prefixIcon: Padding(
                padding: EdgeInsets.only(left: 16, right: 8),
                child: Center(widthFactor: 1, child: Text('+255', style: TextStyle(fontWeight: FontWeight.w700, color: SpColors.ink2, fontSize: 16))),
              ),
            ),
            validator: (v) => isTzMobile(toE164(v ?? '')) ? null : 'Enter a valid Tanzanian mobile number',
          ),
        ];
      case PayFlow.merchant:
        return [
          _label('Merchant code'),
          TextFormField(
            controller: _target,
            autofocus: true,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [LengthLimitingTextInputFormatter(20)],
            decoration: const InputDecoration(hintText: 'e.g. SP123456', prefixIcon: Icon(Icons.storefront_rounded)),
            validator: (v) => (v?.trim().length ?? 0) < 3 ? 'Enter the merchant code' : null,
          ),
        ];
      case PayFlow.withdraw:
      case PayFlow.deposit:
        return [
          _label(flow == PayFlow.withdraw ? 'Withdraw to' : 'Add money from'),
          if (_loadingMethods && _methods == null)
            const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
          else if (_methods?.isEmpty ?? true)
            SpCard(
              onTap: _linkAccount,
              child: const Row(
                children: [
                  Icon(Icons.add_link_rounded, color: SpColors.teal),
                  SizedBox(width: 12),
                  Expanded(child: Text('Link a mobile money account', style: TextStyle(fontWeight: FontWeight.w700))),
                  Icon(Icons.chevron_right_rounded, color: SpColors.inkMuted),
                ],
              ),
            )
          else ...[
            for (final m in _methods!)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SpCard(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  onTap: () => setState(() => _methodId = m.id),
                  child: Row(
                    children: [
                      Icon(
                        m.id == _methodId ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                        color: SpColors.teal,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(m.providerName, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text([m.accountName, m.maskedNumber].whereType<String>().join(' · ')),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            TextButton.icon(
              onPressed: _linkAccount,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Link another account'),
            ),
          ],
        ];
    }
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8, left: 4),
        child: Text(text, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: SpColors.ink2)),
      );
}
