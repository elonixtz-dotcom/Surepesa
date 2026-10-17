import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'linked_accounts_screen.dart';
import 'pay/set_pin_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final me = app.me!;
    final initials = [me.firstName, me.lastName].whereType<String>().map((s) => s[0]).join().toUpperCase();

    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
        children: [
          Text('Profile', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 20),
          SpCard(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: [
                Container(
                  width: 58,
                  height: 58,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(gradient: SpColors.cardGradient, shape: BoxShape.circle),
                  child: Text(initials, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 20)),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(me.displayName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                      const SizedBox(height: 2),
                      Text(me.phoneNumber ?? '', style: const TextStyle(color: SpColors.inkMuted)),
                      if (me.email != null) Text(me.email!, style: const TextStyle(color: SpColors.inkMuted, fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SpCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _Tile(
                  icon: Icons.verified_user_outlined,
                  title: 'Identity verification',
                  trailing: _KycChip(status: me.kycStatus),
                  onTap: () => showComingSoon(context, 'Identity verification'),
                ),
                const Divider(height: 1, indent: 56),
                _Tile(icon: Icons.pin_outlined, title: 'Transaction PIN', onTap: () => _push(context, const SetPinScreen(changing: true))),
                const Divider(height: 1, indent: 56),
                _Tile(
                  icon: Icons.account_balance_outlined,
                  title: 'Linked accounts',
                  onTap: () => _push(context, const LinkedAccountsScreen()),
                ),
                const Divider(height: 1, indent: 56),
                _Tile(icon: Icons.help_outline_rounded, title: 'Help & support', onTap: () => showComingSoon(context, 'Support')),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SpCard(
            padding: EdgeInsets.zero,
            child: _Tile(
              icon: Icons.logout_rounded,
              title: 'Sign out',
              color: SpColors.negative,
              onTap: () => app.signOut(),
            ),
          ),
        ],
      ),
    );
  }
}

void _push(BuildContext context, Widget screen) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));

class _Tile extends StatelessWidget {
  const _Tile({required this.icon, required this.title, this.trailing, this.onTap, this.color});

  final IconData icon;
  final String title;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      leading: Icon(icon, color: color ?? SpColors.tealDark),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: color)),
      trailing: trailing ?? const Icon(Icons.chevron_right_rounded, color: SpColors.inkMuted),
    );
  }
}

class _KycChip extends StatelessWidget {
  const _KycChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'APPROVED' => ('Verified', SpColors.positive),
      'PENDING' => ('In review', const Color(0xFFE0A100)),
      'REJECTED' => ('Rejected', SpColors.negative),
      _ => ('Not started', SpColors.inkMuted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}
