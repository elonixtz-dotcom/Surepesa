import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import '../state/payment_models.dart';
import '../widgets/common.dart';
import '../widgets/receipt_tile.dart';

/// Activity: receipts newest first, grouped by day, paged with `before`. Search and the
/// filter chips narrow what has been loaded so far.
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  final _scroll = ScrollController();
  final List<Receipt> _items = [];
  String? _next;
  bool _loading = false;
  bool _loaded = false;
  String? _error;
  int? _version;
  final _query = TextEditingController();
  _Filter _filter = _Filter.all;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.extentAfter < 300) _loadMore();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Reload when a payment has been made anywhere in the app.
    final version = AppScope.of(context).activityVersion;
    if (version != _version) {
      _version = version;
      // After this frame: _fetch calls setState.
      Future.microtask(_reload);
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    _query.dispose();
    super.dispose();
  }

  Future<void> _reload() => _fetch(reset: true);

  Future<void> _loadMore() async {
    if (_next != null) await _fetch(reset: false);
  }

  Future<void> _fetch({required bool reset}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await AppScope.read(context).payments.history(before: reset ? null : _next);
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(page.items);
        _next = page.next;
        _loaded = true;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _matches(Receipt r) {
    final ok = switch (_filter) {
      _Filter.all => true,
      _Filter.moneyIn => r.isIncoming,
      _Filter.moneyOut => !r.isIncoming,
      _Filter.pending => !r.isFinal,
    };
    if (!ok) return false;
    final q = _query.text.trim().toLowerCase();
    if (q.isEmpty) return true;
    return [r.counterparty?.name, r.counterparty?.account, r.reference, r.typeLabel]
        .whereType<String>()
        .any((v) => v.toLowerCase().contains(q));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final shown = _items.where(_matches).toList();
    final groups = <String, List<Receipt>>{};
    for (final r in shown) {
      groups.putIfAbsent(dayHeading(r.createdAt), () => []).add(r);
    }
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: SpColors.teal,
        onRefresh: _reload,
        child: ListView(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            Text('Activity', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4)),
            const SizedBox(height: 14),
            TextField(
              controller: _query,
              onChanged: (_) => setState(() {}),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search name, number or SPX reference',
                prefixIcon: const Icon(Icons.search_rounded, color: SpColors.inkMuted),
                suffixIcon: _query.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear search',
                        icon: const Icon(Icons.close_rounded, color: SpColors.inkMuted),
                        onPressed: () => setState(_query.clear),
                      ),
              ),
            ),
            const SizedBox(height: 12),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final f in _Filter.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(f.label),
                        selected: _filter == f,
                        showCheckmark: false,
                        onSelected: (_) => setState(() => _filter = f),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (_error != null && _items.isEmpty) ...[
              const SizedBox(height: 40),
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: SpColors.negative)),
              TextButton(onPressed: _reload, child: const Text('Try again')),
            ] else if (!_loaded)
              const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
            else if (shown.isEmpty) ...[
              const SizedBox(height: 40),
              const Center(child: IconChip(icon: Icons.receipt_long_outlined, color: SpColors.ink2, background: SpColors.line, size: 56)),
              const SizedBox(height: 12),
              Text(_items.isEmpty ? 'No activity yet' : 'Nothing matches',
                  textAlign: TextAlign.center, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Text(
                _items.isEmpty
                    ? 'Payments you send and receive will show here, with their SPX reference and status.'
                    : 'Try another name or reference, or choose All.',
                textAlign: TextAlign.center,
                style: text.bodySmall?.copyWith(color: SpColors.ink2, height: 1.5),
              ),
            ] else ...[
              for (final MapEntry(key: day, value: rows) in groups.entries) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
                  child: Text(day.toUpperCase(),
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.8, color: SpColors.inkMuted)),
                ),
                SpCard(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    children: [
                      for (var i = 0; i < rows.length; i++) ...[
                        if (i > 0) const Divider(height: 1, indent: 66, endIndent: 16),
                        ReceiptTile(receipt: rows[i]),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ],
            if (_loaded && _items.isNotEmpty)
              if (_loading)
                const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
              else if (_error != null)
                TextButton(onPressed: _loadMore, child: const Text('Could not load more. Try again'))
              else if (_next != null)
                TextButton(onPressed: _loadMore, child: const Text('Load older activity')),
          ],
        ),
      ),
    );
  }
}

enum _Filter {
  all('All'),
  moneyIn('Money in'),
  moneyOut('Money out'),
  pending('In progress');

  const _Filter(this.label);
  final String label;
}
