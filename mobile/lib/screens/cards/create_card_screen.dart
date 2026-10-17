import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../services/payments_api.dart';
import '../../state/app_state.dart';
import '../pay/pay_widgets.dart';
import '../pay/pin_sheet.dart';
import 'card_detail_screen.dart';

/// Name the card, pick how long it lasts, optionally cap each purchase and load it now.
class CreateCardScreen extends StatefulWidget {
  const CreateCardScreen({super.key});

  @override
  State<CreateCardScreen> createState() => _CreateCardScreenState();
}

class _CreateCardScreenState extends State<CreateCardScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController(text: 'Online shopping');
  final _load = TextEditingController();
  final _limit = TextEditingController();
  int _months = 24;
  // One key per attempt, reused if the customer retries after a dropped connection.
  late final String _key = newIdempotencyKey();

  static const _suggestions = ['Online shopping', 'Netflix', 'Subscriptions', 'Travel'];

  @override
  void dispose() {
    _name.dispose();
    _load.dispose();
    _limit.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    if (!_form.currentState!.validate()) return;
    final app = AppScope.read(context);
    final card = await showPinSheet(
      context,
      summary: _load.text.isEmpty ? 'Create "${_name.text.trim()}"' : 'Create "${_name.text.trim()}" and load TZS ${_load.text}',
      submit: (pin) => app.cards.create(
        nickname: _name.text.trim(),
        pin: pin,
        idempotencyKey: _key,
        validityMonths: _months,
        perTransactionLimit: _limit.text,
        initialLoad: _load.text,
      ),
    );
    if (card == null || !mounted) return;
    if (_load.text.isNotEmpty) app.paymentMade();
    Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => CardDetailScreen(cardId: card.id)));
  }

  @override
  Widget build(BuildContext context) {
    final balance = AppScope.of(context).me?.walletIn('TZS')?.balance;
    return PayScaffold(
      title: 'New virtual card',
      bottom: FilledButton(onPressed: _create, child: const Text('Create card')),
      children: [
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const NoticeBox(text: 'A Visa card for online payments. It spends only what you load onto it, so your main balance stays safe.'),
              const SizedBox(height: 18),
              TextFormField(
                controller: _name,
                maxLength: 30,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Card name'),
                validator: (v) => (v ?? '').trim().isEmpty ? 'Give the card a name' : null,
              ),
              Wrap(spacing: 8, children: [
                for (final s in _suggestions)
                  ActionChip(label: Text(s), onPressed: () => setState(() => _name.text = s)),
              ]),
              const SizedBox(height: 20),
              const Text('Valid for', style: TextStyle(fontWeight: FontWeight.w700, color: SpColors.ink)),
              const SizedBox(height: 8),
              SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 6, label: Text('6 months')),
                  ButtonSegment(value: 12, label: Text('1 year')),
                  ButtonSegment(value: 24, label: Text('2 years')),
                ],
                selected: {_months},
                onSelectionChanged: (s) => setState(() => _months = s.first),
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _load,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9)],
                decoration: InputDecoration(
                  labelText: 'Load now (optional)',
                  prefixText: 'TZS ',
                  helperText: balance == null ? null : 'Available: ${formatMoney(balance, 'TZS')}',
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _limit,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9)],
                decoration: const InputDecoration(
                  labelText: 'Limit per purchase (optional)',
                  prefixText: 'TZS ',
                  helperText: 'Purchases above this are declined. You can change it later.',
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
