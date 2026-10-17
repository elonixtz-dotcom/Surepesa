import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../state/app_state.dart';
import '../../state/card_models.dart';
import '../../widgets/virtual_card_face.dart';
import '../pay/pay_widgets.dart';
import 'card_detail_screen.dart';
import 'create_card_screen.dart';

/// "My cards": every virtual card, newest first, with a way to create one.
class CardsScreen extends StatefulWidget {
  const CardsScreen({super.key});

  @override
  State<CardsScreen> createState() => _CardsScreenState();
}

class _CardsScreenState extends State<CardsScreen> {
  List<VirtualCard>? _cards;
  int _max = 3;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final (cards, max) = await AppScope.read(context).cards.list();
      if (mounted) {
        setState(() {
          _cards = cards;
          _max = max;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final cards = _cards;
    final open = cards?.where((c) => c.isOpen || c.status == 'REQUESTED').length ?? 0;
    final canCreate = cards != null && open < _max;
    return PayScaffold(
      title: 'My cards',
      bottom: cards == null
          ? null
          : FilledButton.icon(
              onPressed: canCreate ? () => _open(const CreateCardScreen()) : null,
              icon: const Icon(Icons.add_card_rounded),
              label: Text(canCreate ? 'Create a virtual card' : 'You have $_max cards (the maximum)'),
            ),
      children: [
        if (_error != null) NoticeBox(text: _error!, warning: true),
        if (cards == null && _error == null) const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
        if (cards != null && cards.isEmpty) const _Empty(),
        if (cards != null)
          for (final c in cards)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Semantics(
                button: true,
                label: '${c.nickname}, card ending ${c.last4}, balance ${c.balance.formatted}',
                child: GestureDetector(
                  onTap: () => _open(CardDetailScreen(cardId: c.id)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      VirtualCardFace(card: c),
                      const SizedBox(height: 8),
                      Row(children: [
                        Text(c.isClosed ? 'Closed' : c.balance.formatted,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: SpColors.ink)),
                        const Spacer(),
                        if (c.status == 'REQUESTED') const Text('Being issued…', style: TextStyle(color: SpColors.inkMuted)),
                        const Icon(Icons.chevron_right_rounded, color: SpColors.inkMuted),
                      ]),
                    ],
                  ),
                ),
              ),
            ),
      ],
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(children: [
          const Icon(Icons.credit_card_rounded, size: 56, color: SpColors.teal),
          const SizedBox(height: 12),
          Text('Pay online with a virtual Visa', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text(
            'Create a card in seconds, load it from your SurePesa balance, and use it for Netflix, Spotify, shopping and subscriptions. Freeze it any time.',
            textAlign: TextAlign.center,
            style: TextStyle(color: SpColors.inkMuted, height: 1.4),
          ),
        ]),
      );
}
