import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

/// Collects name and Tanzanian phone number, then activates the wallet.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _form = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _phone = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    _phone.dispose();
    super.dispose();
  }

  /// Accepts 0712345678 or 712345678 and returns +255712345678.
  static String _toE164(String input) {
    final digits = input.replaceAll(RegExp(r'\D'), '');
    return '+255${digits.startsWith('0') ? digits.substring(1) : digits}';
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await AppScope.read(context).completeOnboarding(
        firstName: _first.text.trim(),
        lastName: _last.text.trim(),
        phoneNumber: _toE164(_phone.text),
      );
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        actions: [
          TextButton(
            onPressed: _busy ? null : () => AppScope.read(context).signOut(),
            child: const Text('Sign out', style: TextStyle(color: SpColors.inkMuted)),
          ),
        ],
      ),
      extendBodyBehindAppBar: true,
      body: GradientBackground(
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Set up your wallet', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text(
                    'Your phone number is how friends find you on SurePesa.',
                    style: text.bodyMedium?.copyWith(color: SpColors.inkMuted),
                  ),
                  const SizedBox(height: 28),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _first,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(hintText: 'First name'),
                          validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _last,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(hintText: 'Last name'),
                          validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
                    decoration: const InputDecoration(
                      hintText: '712 345 678',
                      prefixIcon: Padding(
                        padding: EdgeInsets.only(left: 16, right: 8),
                        child: Center(
                          widthFactor: 1,
                          child: Text('🇹🇿 +255', style: TextStyle(fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ),
                    validator: (v) {
                      final e164 = _toE164(v ?? '');
                      return RegExp(r'^\+255[67]\d{8}$').hasMatch(e164) ? null : 'Enter a valid Tanzanian mobile number';
                    },
                  ),
                  const SizedBox(height: 28),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                        : const Text('Continue'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
