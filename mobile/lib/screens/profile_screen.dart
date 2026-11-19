import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'linked_accounts_screen.dart';
import 'pay/set_pin_screen.dart';
import 'verify_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final me = app.me!;
    final (kycLabel, kycTone) = switch (me.kycStatus) {
      'APPROVED' => ('Verified', PillTone.positive),
      'PENDING' => ('In review', PillTone.warning),
      'REJECTED' => ('Action needed', PillTone.negative),
      _ => ('Not verified', PillTone.neutral),
    };

    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        children: [
          Text('Profile', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4)),
          const SizedBox(height: 16),
          SpCard(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: [
                InitialsAvatar(name: me.displayName, size: 56, onDark: true),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(me.displayName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                      const SizedBox(height: 2),
                      Text(maskPhone(me.phoneNumber) ?? '', style: const TextStyle(color: SpColors.ink2)),
                      if (me.email != null) Text(me.email!, style: const TextStyle(color: SpColors.inkMuted, fontSize: 12)),
                      const SizedBox(height: 8),
                      StatusPill(label: kycLabel, tone: kycTone),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const SectionHeader(title: 'Security', caps: true),
          const SizedBox(height: 8),
          SpCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _Tile(
                  icon: Icons.pin_outlined,
                  title: 'Change PIN',
                  subtitle: 'Used to confirm every payment',
                  onTap: () => _push(context, const SetPinScreen(changing: true)),
                ),
                const Divider(height: 1, indent: 64),
                _Tile(
                  icon: Icons.fingerprint_rounded,
                  title: 'Fingerprint unlock',
                  subtitle: 'Open SurePesa without typing your PIN',
                  onTap: () => showComingSoon(context, 'Fingerprint unlock'),
                ),
                const Divider(height: 1, indent: 64),
                _Tile(
                  icon: Icons.verified_user_outlined,
                  title: 'Identity verification',
                  trailing: StatusPill(label: kycLabel, tone: kycTone),
                  onTap: () => _push(context, const VerifyScreen()),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const SectionHeader(title: 'Money', caps: true),
          const SizedBox(height: 8),
          SpCard(
            padding: EdgeInsets.zero,
            child: _Tile(
              icon: Icons.account_balance_outlined,
              title: 'Linked mobile money',
              subtitle: 'Numbers you add money from and withdraw to',
              onTap: () => _push(context, const LinkedAccountsScreen()),
            ),
          ),
          const SizedBox(height: 20),
          const SectionHeader(title: 'Help', caps: true),
          const SizedBox(height: 8),
          SpCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _Tile(icon: Icons.support_agent_rounded, title: 'Contact support', onTap: () => showComingSoon(context, 'Support')),
                const Divider(height: 1, indent: 64),
                _Tile(icon: Icons.description_outlined, title: 'Terms and privacy', onTap: () => showComingSoon(context, 'Terms and privacy')),
              ],
            ),
          ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: () => app.signOut(),
            style: OutlinedButton.styleFrom(
              foregroundColor: SpColors.negative,
              side: const BorderSide(color: SpColors.border),
              minimumSize: const Size.fromHeight(52),
            ),
            icon: const Icon(Icons.logout_rounded),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}

void _push(BuildContext context, Widget screen) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));

class _Tile extends StatelessWidget {
  const _Tile({required this.icon, required this.title, this.subtitle, this.trailing, this.onTap});

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      leading: IconChip(icon: icon, color: SpColors.ink2, background: SpColors.line),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      subtitle: subtitle == null ? null : Text(subtitle!, style: const TextStyle(fontSize: 12, color: SpColors.inkMuted)),
      trailing: trailing ?? const Icon(Icons.chevron_right_rounded, color: SpColors.inkMuted),
    );
  }
}
