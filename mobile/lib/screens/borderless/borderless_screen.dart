import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/borderless_models.dart';
import '../../widgets/common.dart';
import '../pay/pay_widgets.dart';

/// Borderless (blueprint §7): pick a supported corridor, get a live FX quote with the
/// fee and recipient amount, then send with your PIN. Quotes expire in 5 minutes.
class BorderlessScreen extends StatefulWidget {
  const BorderlessScreen({super.key});

  @override
  State<BorderlessScreen> createState() => _BorderlessScreenState();
}

class _BorderlessScreenState extends State<BorderlessScreen> {
  List<Corridor>? _corridors;
  Corridor? _corridor;
  final _amount = TextEditingController();
  final _recipient = TextEditingController();
  FxQuoteView? _quote;
  List<TransferView>? _transfers;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    _recipient.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = AppScope.read(context).borderless;
      final results = await Future.wait([api.corridors(), api.transfers()]);
      if (mounted) {
        setState(() {
          _corridors = results[0] as List<Corridor>;
          _corridor = (_corridors!.isNotEmpty ? _corridors!.first : null);
          _transfers = results[1] as List<TransferView>;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _getQuote() async {
    final minor = toMinorUnitsString(_amount.text);
    if (_corridor == null || minor == null) {
      showError(context, 'Choose a corridor and enter a valid amount');
      return;
    }
    setState(() {
      _busy = true;
      _quote = null;
    });
    try {
      final quote = await AppScope.read(context).borderless.quote(corridorId: _corridor!.id, sourceAmountMinor: minor);
      if (mounted) setState(() => _quote = quote);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    final quote = _quote;
    if (quote == null) return;
    if (!RegExp(r'^\+255[67]\d{8}$').hasMatch(_recipient.text.trim())) {
      showError(context, 'Enter the recipient phone as +2557XXXXXXXX');
      return;
    }
    final pinController = TextEditingController();
    final pin = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirm with your PIN'),
        content: TextField(
          controller: pinController,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 6,
          decoration: const InputDecoration(labelText: 'PIN', counterText: ''),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, pinController.text.trim()), child: const Text('Send')),
        ],
      ),
    );
    if (pin == null || pin.isEmpty) return;
    setState(() => _busy = true);
    try {
      final api = AppScope.read(context).borderless;
      await api.acceptQuote(quote.id);
      final transfer = await api.send(quoteId: quote.id, recipientPhone: _recipient.text.trim(), pin: pin);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Sent — ${transfer.reference}')));
      setState(() {
        _quote = null;
        _amount.clear();
        _recipient.clear();
      });
      await AppScope.read(context).paymentMade();
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final quote = _quote;
    return Scaffold(
      appBar: AppBar(title: const Text('Cross-border')),
      body: GradientBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
            children: [
              if (_error != null)
                InfoNotice(tone: PillTone.negative, text: _error.toString())
              else if (_corridors == null)
                const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
              else if (_corridors!.isEmpty)
                const InfoNotice(text: 'No cross-border corridors are available yet.')
              else ...[
                const InfoNotice(text: 'Rates and fees are locked into your quote for 5 minutes. The recipient gets exactly the quoted amount.'),
                const SizedBox(height: 16),
                SpCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: _corridor?.id,
                        decoration: const InputDecoration(labelText: 'Corridor'),
                        items: [
                          for (final c in _corridors!)
                            DropdownMenuItem(
                              value: c.id,
                              child: Text('${c.originCountry} ${c.sourceCurrency} → ${c.destinationCountry} ${c.destinationCurrency}'),
                            ),
                        ],
                        onChanged: (id) => setState(() {
                          _corridor = _corridors!.firstWhere((c) => c.id == id);
                          _quote = null;
                        }),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _amount,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(labelText: 'You send (${_corridor?.sourceCurrency ?? 'TZS'})'),
                        onChanged: (_) => setState(() => _quote = null),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _getQuote,
                        icon: const Icon(Icons.currency_exchange_rounded),
                        label: const Text('Get quote'),
                      ),
                      if (quote != null) ...[
                        const Divider(height: 28),
                        _QuoteRow('Rate', '1 ${quote.sourceCurrency} = ${quote.rate} ${quote.destinationCurrency}'),
                        _QuoteRow('Fee', formatMinorUnits(quote.feeMinor, quote.sourceCurrency)),
                        _QuoteRow('Recipient gets', formatMinorUnits(quote.destinationAmountMinor, quote.destinationCurrency)),
                        _QuoteRow('Quote expires', formatShortDateTime(quote.expiresAt.toLocal())),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _recipient,
                          keyboardType: TextInputType.phone,
                          decoration: const InputDecoration(labelText: 'Recipient phone (+2557…)', hintText: '+255712345678'),
                        ),
                        const SizedBox(height: 12),
                        BusyButton(label: 'Send now', busy: _busy, onPressed: _send),
                      ],
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 20),
              const SectionHeader(title: 'Transfers'),
              if (_transfers == null)
                const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator()))
              else if (_transfers!.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('No transfers yet', style: TextStyle(color: SpColors.ink2)),
                )
              else
                for (final t in _transfers!) ...[
                  SpCard(
                    child: Row(
                      children: [
                        IconChip(
                          icon: t.role == 'SENDER' ? Icons.north_east_rounded : Icons.south_west_rounded,
                          background: t.role == 'SENDER' ? SpColors.mint : SpColors.infoSoft,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(t.reference, style: const TextStyle(fontWeight: FontWeight.w700)),
                              Text(
                                '${t.sourceAmountMinor == null ? '' : '${formatMinorUnits(t.sourceAmountMinor, t.sourceCurrency ?? '')} → '}${formatMinorUnits(t.destinationAmountMinor, t.destinationCurrency ?? '')}',
                                style: const TextStyle(color: SpColors.ink2, fontSize: 12.5),
                              ),
                            ],
                          ),
                        ),
                        StatusPill(
                          label: t.status,
                          tone: t.status == 'SUCCESS' ? PillTone.positive : PillTone.warning,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
            ],
          ),
        ),
      ),
    );
  }
}

class _QuoteRow extends StatelessWidget {
  const _QuoteRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          children: [
            Expanded(child: Text(label, style: const TextStyle(color: SpColors.ink2))),
            Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
          ],
        ),
      );
}
