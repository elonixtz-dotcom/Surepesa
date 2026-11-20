import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/theme.dart';
import '../services/notifications_api.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

/// The bell: in-app notifications written by payments, cards, circles, escrow and KYC.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<AppNotification>? _items;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = AppScope.read(context).notifications;
    try {
      final items = await api.list();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
      if (items.any((n) => !n.read)) {
        await api.markAllRead();
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: Builder(builder: (context) {
          final items = _items;
          if (_error != null) {
            return ListView(children: [
              const SizedBox(height: 80),
              const Center(child: Text('Could not load notifications', style: TextStyle(color: SpColors.ink2))),
              const SizedBox(height: 12),
              Center(child: TextButton(onPressed: _load, child: const Text('Try again'))),
            ]);
          }
          if (items == null) {
            return const Center(child: CircularProgressIndicator());
          }
          if (items.isEmpty) {
            return ListView(children: const [
              SizedBox(height: 120),
              Center(child: Icon(Icons.notifications_none_rounded, size: 56, color: SpColors.inkMuted)),
              SizedBox(height: 12),
              Center(child: Text('Nothing here yet', style: TextStyle(fontWeight: FontWeight.w700))),
              SizedBox(height: 4),
              Center(child: Text('Payments, cards and circle activity will show up here.')),
            ]);
          }
          final dateFmt = DateFormat('d MMM, HH:mm');
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) {
              final n = items[i];
              return SpCard(
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    IconChip(icon: n.read ? Icons.notifications_none_rounded : Icons.notifications_active_rounded),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(n.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                          if (n.body.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(n.body, style: const TextStyle(color: SpColors.ink2, fontSize: 13, height: 1.4)),
                          ],
                          const SizedBox(height: 6),
                          Text(dateFmt.format(n.createdAt.toLocal()),
                              style: const TextStyle(color: SpColors.inkMuted, fontSize: 11)),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          );
        }),
      ),
    );
  }
}
