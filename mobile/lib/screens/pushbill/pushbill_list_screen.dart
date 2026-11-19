import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/pushbill_models.dart';
import '../../widgets/common.dart';
import 'create_pushbill_screen.dart';
import 'pushbill_detail_screen.dart';

/// PushBill ★ home: open requests (sent and received) and the entry point for a new one.
class PushBillListScreen extends StatefulWidget {
  const PushBillListScreen({super.key});

  @override
  State<PushBillListScreen> createState() => _PushBillListScreenState();
}

class _PushBillListScreenState extends State<PushBillListScreen> {
  List<PushBillSession>? _items;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final page = await AppScope.read(context).pushBills.list();
      if (mounted) {
        setState(() {
          _items = page.items;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  (String, PillTone) _statusOf(PushBillSession s) => switch (s.state) {
        'PAID' => ('Paid', PillTone.positive),
        'DECLINED' || 'NO_ANSWER' || 'MISMATCH' || 'PAYMENT_FAILED' => ('Failed', PillTone.negative),
        'EXPIRED' || 'CANCELLED' => ('Closed', PillTone.neutral),
        _ => ('In progress', PillTone.warning),
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('PushBill')),
      body: GradientBackground(
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
              children: [
                const InfoNotice(
                  text: 'Ask another SurePesa user to pay a merchant for you. You both confirm the details on a normal phone call before any money moves.',
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  InfoNotice(tone: PillTone.negative, text: _error.toString())
                else if (_items == null)
                  const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
                else if (_items!.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: Center(child: Text('No requests yet', style: TextStyle(color: SpColors.ink2))),
                  )
                else
                  for (final s in _items!) ...[
                    SpCard(
                      onTap: () => Navigator.of(context)
                          .push(MaterialPageRoute<void>(builder: (_) => PushBillDetailScreen(sessionId: s.id)))
                          .then((_) => _load()),
                      child: Row(
                        children: [
                          IconChip(
                            icon: s.isPayer ? Icons.call_received_rounded : Icons.call_made_rounded,
                            background: s.isPayer ? SpColors.infoSoft : SpColors.mint,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(s.destinationLabel ?? 'Merchant',
                                    style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text('${s.amountFormatted} · ${s.isPayer ? 'they ask you' : 'you asked'}',
                                    style: const TextStyle(color: SpColors.ink2, fontSize: 12.5)),
                              ],
                            ),
                          ),
                          StatusPill(label: _statusOf(s).$1, tone: _statusOf(s).$2),
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
            .push(MaterialPageRoute<void>(builder: (_) => const CreatePushBillScreen()))
            .then((_) => _load()),
        icon: const Icon(Icons.add_rounded),
        label: const Text('New request'),
      ),
    );
  }
}
