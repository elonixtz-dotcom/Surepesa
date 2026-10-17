import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../state/payment_models.dart';
import '../widgets/common.dart';
import '../widgets/receipt_tile.dart';

/// Transaction history as receipts, newest first, paged with `before`.
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

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: SpColors.teal,
        onRefresh: _reload,
        child: ListView(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
          children: [
            Text('History', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            if (_error != null && _items.isEmpty) ...[
              const SizedBox(height: 40),
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: SpColors.negative)),
              TextButton(onPressed: _reload, child: const Text('Try again')),
            ] else if (!_loaded)
              const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
            else if (_items.isEmpty) ...[
              const SizedBox(height: 40),
              const Icon(Icons.receipt_long_outlined, size: 56, color: SpColors.tealLight),
              const SizedBox(height: 12),
              Text('Nothing here yet',
                  textAlign: TextAlign.center, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Text(
                'Payments you send and receive will show up here,\nwith their SPX reference and status.',
                textAlign: TextAlign.center,
                style: text.bodySmall?.copyWith(color: SpColors.inkMuted),
              ),
            ] else ...[
              SpCard(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(
                  children: [
                    for (var i = 0; i < _items.length; i++) ...[
                      if (i > 0) const Divider(height: 1, indent: 68),
                      ReceiptTile(receipt: _items[i]),
                    ],
                  ],
                ),
              ),
              if (_loading)
                const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
              else if (_error != null)
                TextButton(onPressed: _loadMore, child: const Text('Could not load more. Try again'))
              else if (_next != null)
                TextButton(onPressed: _loadMore, child: const Text('Load more')),
            ],
          ],
        ),
      ),
    );
  }
}
