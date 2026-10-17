import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../widgets/common.dart';

/// Transaction history. Wired to the API once the payments endpoints ship (milestone 7).
class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
        children: [
          Text('History', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          TextField(
            readOnly: true,
            onTap: () => showComingSoon(context, 'Transaction search'),
            decoration: const InputDecoration(
              hintText: 'Search transactions...',
              prefixIcon: Icon(Icons.search_rounded),
              suffixIcon: Icon(Icons.tune_rounded),
            ),
          ),
          const SizedBox(height: 40),
          const Icon(Icons.receipt_long_outlined, size: 56, color: SpColors.tealLight),
          const SizedBox(height: 12),
          Text('Nothing here yet', textAlign: TextAlign.center, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(
            'Payments you send and receive will show up here,\nwith their SPX reference and status.',
            textAlign: TextAlign.center,
            style: text.bodySmall?.copyWith(color: SpColors.inkMuted),
          ),
        ],
      ),
    );
  }
}
