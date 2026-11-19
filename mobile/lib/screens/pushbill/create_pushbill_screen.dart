import 'package:flutter/material.dart';

import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../pay/pay_widgets.dart';
import 'pushbill_detail_screen.dart';

/// Starts a PushBill request: where to pay, how much, and who should pay it.
/// The server verifies the destination before the payer is ever notified.
class CreatePushBillScreen extends StatefulWidget {
  const CreatePushBillScreen({super.key});

  @override
  State<CreatePushBillScreen> createState() => _CreatePushBillScreenState();
}

class _CreatePushBillScreenState extends State<CreatePushBillScreen> {
  final _form = GlobalKey<FormState>();
  final _destination = TextEditingController();
  final _payerPhone = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _kind = 'MERCHANT_CODE';
  bool _busy = false;

  @override
  void dispose() {
    _destination.dispose();
    _payerPhone.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String get _destinationLabel => switch (_kind) {
        'QR_CODE' => 'QR token',
        'AGENT_NUMBER' => 'Agent number',
        _ => 'Lipa Namba / merchant code',
      };

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final session = await AppScope.read(context).pushBills.create(
            destinationKind: _kind,
            destination: _destination.text.trim(),
            payerPhone: _payerPhone.text.trim(),
            amount: _amount.text.trim(),
            note: _note.text.trim(),
          );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => PushBillDetailScreen(sessionId: session.id)),
      );
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PayScaffold(
      title: 'Ask someone to pay',
      bottom: BusyButton(label: 'Send request', busy: _busy, onPressed: _submit),
      children: [
        const InfoNotice(
          text: 'The payer confirms the details on a normal phone call with you before any money moves. Never share your PIN on the call.',
        ),
        const SizedBox(height: 20),
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'QR_CODE', label: Text('QR'), icon: Icon(Icons.qr_code_2_rounded)),
                  ButtonSegment(value: 'MERCHANT_CODE', label: Text('Lipa Namba')),
                  ButtonSegment(value: 'AGENT_NUMBER', label: Text('Agent')),
                ],
                selected: {_kind},
                onSelectionChanged: (s) => setState(() => _kind = s.first),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _destination,
                decoration: InputDecoration(labelText: _destinationLabel),
                validator: (v) => (v == null || v.trim().length < 3) ? 'Enter the destination' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount (TZS)'),
                validator: (v) {
                  final parsed = double.tryParse(v?.trim() ?? '');
                  return (parsed == null || parsed <= 0) ? 'Enter a valid amount' : null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _payerPhone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Payer phone (+2557…)', hintText: '+255712345678'),
                validator: (v) =>
                    RegExp(r'^\+255[67]\d{8}$').hasMatch(v?.trim() ?? '') ? null : 'Use the format +2557XXXXXXXX',
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _note,
                maxLength: 140,
                decoration: const InputDecoration(labelText: 'Purpose (optional)', counterText: ''),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
