import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../widgets/common.dart';

/// Ways to reach SurePesa support. Tapping a row copies the contact detail.
class SupportScreen extends StatelessWidget {
  const SupportScreen({super.key});

  Future<void> _copy(BuildContext context, String label, String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$label copied')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Contact support')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          const InfoNotice(
            icon: Icons.schedule_rounded,
            tone: PillTone.info,
            text: 'We answer every day, 7:00 to 22:00 EAT. Disputes on escrow deals are reviewed within 3 working days.',
          ),
          const SizedBox(height: 16),
          SpCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _Contact(
                  icon: Icons.email_outlined,
                  label: 'Email',
                  value: 'support@surepesa.co.tz',
                  onTap: () => _copy(context, 'Email address', 'support@surepesa.co.tz'),
                ),
                const Divider(height: 1, indent: 64),
                _Contact(
                  icon: Icons.call_outlined,
                  label: 'Phone',
                  value: '+255 800 000 000',
                  onTap: () => _copy(context, 'Phone number', '+255800000000'),
                ),
                const Divider(height: 1, indent: 64),
                _Contact(
                  icon: Icons.chat_bubble_outline_rounded,
                  label: 'WhatsApp',
                  value: '+255 700 000 000',
                  onTap: () => _copy(context, 'WhatsApp number', '+255700000000'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              'When you write to us, include the reference of the payment or deal you need help with — it is on its receipt.',
              style: TextStyle(color: SpColors.ink2, fontSize: 13, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }
}

class _Contact extends StatelessWidget {
  const _Contact({required this.icon, required this.label, required this.value, required this.onTap});

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      leading: IconChip(icon: icon, color: SpColors.ink2, background: SpColors.line),
      title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      subtitle: Text(value, style: const TextStyle(fontSize: 13, color: SpColors.ink2)),
      trailing: const Icon(Icons.copy_rounded, size: 18, color: SpColors.inkMuted),
    );
  }
}

/// The customer-facing terms and privacy summary.
class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key});

  static const _sections = [
    (
      'Your money',
      'Money you add to SurePesa is held in your SurePesa wallet in Tanzanian shillings. '
          'Escrow deals keep funds in a separate holding wallet until both sides confirm, or a dispute is resolved.',
    ),
    (
      'Payments',
      'Every payment is confirmed with your PIN. Once a payment is completed it is final and appears in your activity '
          'with a reference you can quote to support. Fees are always shown before you confirm.',
    ),
    (
      'Virtual cards',
      'Virtual cards spend from your wallet balance. Online merchants charge the card in its currency; '
          'a card can be frozen or closed at any time, which declines new charges immediately.',
    ),
    (
      'Circles',
      'Circles track group goals and contributions for planning. A contribution marked in a circle is only '
          'confirmed when it is backed by a real SurePesa payment — circles never hold or move money themselves.',
    ),
    (
      'Your data',
      'We store your name, phone number, email and identity documents to run the service and meet Tanzanian '
          'payment regulations. Identity documents are stored privately, are never shared with other users, and are '
          'used only to verify your identity. We do not sell your data.',
    ),
    (
      'Keeping your account safe',
      'Never share your PIN or password. SurePesa staff will never ask for them. If you think someone else has '
          'access to your account, change your PIN and contact support straight away.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Terms and privacy')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          for (final (title, body) in _sections) ...[
            SectionHeader(title: title),
            const SizedBox(height: 6),
            Text(body, style: const TextStyle(fontSize: 14, height: 1.6, color: SpColors.ink2)),
            const SizedBox(height: 18),
          ],
          const Text(
            'SurePesa · Dar es Salaam, Tanzania\nThese terms were last updated in November 2026.',
            style: TextStyle(fontSize: 12, color: SpColors.inkMuted, height: 1.5),
          ),
        ],
      ),
    );
  }
}
