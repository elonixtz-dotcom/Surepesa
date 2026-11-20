import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/escrow_models.dart';
import '../../widgets/common.dart';
import '../pay/pay_widgets.dart';
import 'escrow_detail_screen.dart';

/// Escrow ★ home: protected deals (buying and selling) and the create flow.
class EscrowScreen extends StatefulWidget {
  const EscrowScreen({super.key});

  @override
  State<EscrowScreen> createState() => _EscrowScreenState();
}

class _EscrowScreenState extends State<EscrowScreen> {
  List<EscrowCaseView>? _items;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await AppScope.read(context).escrow.list();
      if (mounted) {
        setState(() {
          _items = items;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  (String, PillTone) _statusOf(EscrowCaseView c) => switch (c.status) {
        'RELEASED' => ('Released', PillTone.positive),
        'REFUNDED' => ('Refunded', PillTone.positive),
        'DISPUTED' || 'REVIEW_REQUIRED' => ('Disputed', PillTone.negative),
        'FUNDED' || 'FULFILMENT_IN_PROGRESS' || 'AWAITING_BUYER_CONFIRMATION' => ('Secured', PillTone.info),
        'DECLINED' || 'EXPIRED' || 'CANCELLED' || 'FUNDING_FAILED' => ('Closed', PillTone.neutral),
        _ => ('In progress', PillTone.warning),
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Escrow')),
      body: GradientBackground(
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
              children: [
                const InfoNotice(
                  text: 'Escrow protects both sides: the buyer’s money is locked in a dedicated holding account and only reaches the seller after delivery is confirmed.',
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  InfoNotice(tone: PillTone.negative, text: _error.toString())
                else if (_items == null)
                  const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
                else if (_items!.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: Center(child: Text('No deals yet', style: TextStyle(color: SpColors.ink2))),
                  )
                else
                  for (final c in _items!) ...[
                    SpCard(
                      onTap: () => Navigator.of(context)
                          .push(MaterialPageRoute<void>(builder: (_) => EscrowDetailScreen(caseId: c.id)))
                          .then((_) => _load()),
                      child: Row(
                        children: [
                          IconChip(
                            icon: c.isBuyer ? Icons.shopping_bag_outlined : Icons.storefront_rounded,
                            background: c.isBuyer ? SpColors.mint : SpColors.infoSoft,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(c.itemDescription, maxLines: 1, overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text('${formatMinorUnits(c.amountMinor, c.currencyCode)} · ${c.isBuyer ? 'you buy' : 'you sell'} · ${c.reference}',
                                    style: const TextStyle(color: SpColors.ink2, fontSize: 12.5)),
                              ],
                            ),
                          ),
                          StatusPill(label: _statusOf(c).$1, tone: _statusOf(c).$2),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context)
            .push(MaterialPageRoute<void>(builder: (_) => const CreateEscrowScreen()))
            .then((_) => _load()),
        icon: const Icon(Icons.add_rounded),
        label: const Text('New deal'),
      ),
    );
  }
}

/// Creates a protected deal as the buyer: what, how much, and who the seller is.
/// The fee shown on the deal is fixed at creation and disclosed to both sides.
class CreateEscrowScreen extends StatefulWidget {
  const CreateEscrowScreen({super.key});

  @override
  State<CreateEscrowScreen> createState() => _CreateEscrowScreenState();
}

class _CreateEscrowScreenState extends State<CreateEscrowScreen> {
  final _form = GlobalKey<FormState>();
  final _seller = TextEditingController();
  final _item = TextEditingController();
  final _amount = TextEditingController();
  int _deliveryDays = 7;
  int _inspectionDays = 3;
  bool _busy = false;

  @override
  void dispose() {
    _seller.dispose();
    _item.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final minor = toMinorUnitsString(_amount.text);
    if (minor == null) {
      showError(context, 'Enter a valid amount');
      return;
    }
    setState(() => _busy = true);
    try {
      final deal = await AppScope.read(context).escrow.create(
            sellerPhone: _seller.text.trim(),
            itemDescription: _item.text.trim(),
            amountMinor: minor,
            deliveryDays: _deliveryDays,
            inspectionDays: _inspectionDays,
          );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => EscrowDetailScreen(caseId: deal.id)),
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
      title: 'Buy with Escrow',
      bottom: BusyButton(label: 'Send offer to seller', busy: _busy, onPressed: _submit),
      children: [
        const InfoNotice(
          text: 'The seller must accept these exact terms. Your money is locked only after you fund the deal with your PIN, and released only when you confirm delivery.',
        ),
        const SizedBox(height: 20),
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _seller,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Seller phone (+2557…)', hintText: '+255712345678'),
                validator: (v) =>
                    RegExp(r'^\+255[67]\d{8}$').hasMatch(v?.trim() ?? '') ? null : 'Use the format +2557XXXXXXXX',
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _item,
                maxLength: 200,
                decoration: const InputDecoration(labelText: 'What are you buying?', counterText: ''),
                validator: (v) => (v == null || v.trim().length < 4) ? 'Describe the item or service' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Price (TZS)'),
                validator: (v) => toMinorUnitsString(v ?? '') == null ? 'Enter a valid amount' : null,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<int>(
                      initialValue: _deliveryDays,
                      decoration: const InputDecoration(labelText: 'Delivery within'),
                      items: const [3, 5, 7, 14, 30]
                          .map((d) => DropdownMenuItem(value: d, child: Text('$d days')))
                          .toList(),
                      onChanged: (v) => setState(() => _deliveryDays = v ?? 7),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButtonFormField<int>(
                      initialValue: _inspectionDays,
                      decoration: const InputDecoration(labelText: 'Inspection window'),
                      items: const [1, 3, 5, 7]
                          .map((d) => DropdownMenuItem(value: d, child: Text('$d days')))
                          .toList(),
                      onChanged: (v) => setState(() => _inspectionDays = v ?? 3),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
